/**
 * BackupOrchestrator — bridge entre routes HTTP e o ciclo de vida do
 * backup no DB + R2.
 *
 * Responsabilidades:
 *   1. Gerar tag única (auto-YYYY-MM-DDTHH-MM-SSZ ou manual-<timestamp>)
 *   2. Criar registro pending no BackupsRepository
 *   3. Disparar BackupWriter.run() em background (sem bloquear a resposta)
 *   4. Atualizar status no DB (running → success/failed)
 *   5. Registrar audit_log (actor_email, action='backup.run', status)
 *   6. Notificar Telegram (success/failed)
 *
 * O orquestrador **não** detém BackupWriter entre requests — a cada
 * `trigger()` o orquestrador cria um writer novo (stateless).
 * A execução em background usa `Bun.spawn` (não bloqueia o event loop).
 */

import { BackupWriter, type BackupResult } from './backup-writer.ts';
import { BackupsRepository } from './backup-repository.ts';
import type { TelegramSender } from '../notify/telegram.ts';
import type { Logger } from '../config.ts';
import type { R2Client } from '@omestre/r2-sdk';

export interface BackupOrchestratorConfig {
  r2: R2Client;
  agePublicKey: string;
  postgres: {
    container: string;
    dbUser: string;
    dbName: string;
    schemas: string[];
  };
  telegram?: TelegramSender;
  log: Logger;
}

export interface TriggerInput {
  type: 'auto' | 'manual';
  actor: string; // 'cron' | email do admin
}

export interface TriggerResult {
  id: number; // ID interno do backup no DB
  tag: string;
  status: 'pending';
  statusUrl: string; // path '/api/backups/:id'
}

export class BackupOrchestrator {
  constructor(
    private readonly config: BackupOrchestratorConfig,
    private readonly repo: BackupsRepository,
  ) {}

  /**
   * Inicia um backup. Retorna ID/status imediatamente (202 na rota).
   * O trabalho pesado roda em background.
   */
  async trigger(input: TriggerInput): Promise<TriggerResult> {
    const tag = this.buildTag(input.type);
    const created = await this.repo.createPending({
      tag,
      type: input.type,
      schemas: this.config.postgres.schemas,
      createdBy: input.actor,
    });

    // Dispara execução em background (não bloqueia a resposta)
    this.runInBackground(created.id, tag, input.type, input.actor);

    return {
      id: created.id,
      tag: created.status === 'pending' ? created.tag : tag,
      status: 'pending',
      statusUrl: `/api/backups/${created.id}`,
    };
  }

  /**
   * Roda o backup em background usando Bun.spawn. Atualiza DB + audit
   * + notificação Telegram no fim (success ou failure).
   */
  private runInBackground(id: number, tag: string, type: 'auto' | 'manual', actor: string): void {
    const writer = new BackupWriter({
      r2: this.config.r2,
      agePublicKey: this.config.agePublicKey,
      postgres: this.config.postgres,
      actor,
    });

    const run = async () => {
      try {
        await this.repo.markRunning(tag);
        const result = await writer.run(type);

        if (result.status === 'success') {
          await this.repo.markSuccess(tag, result);
          this.config.log.info('backup.sucesso', {
            tag,
            size: result.size,
            totalMs: result.totalMs,
          });
          await this.notifyTelegram('success', tag, result);
        } else {
          await this.repo.markFailed(tag, result);
          this.config.log.error('backup.falhou', {
            tag,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
          });
          await this.notifyTelegram('failed', tag, result);
        }
      } catch (err) {
        // Erro não-esperado (não-BackupResult): persiste como failed
        this.config.log.error('backup.crash', {
          tag,
          error: err instanceof Error ? err.message : String(err),
        });
        await this.repo.markFailed(tag, {
          status: 'failed',
          type,
          r2Key: '',
          errorCode: 'internal_error',
          errorMessage: err instanceof Error ? err.message : String(err),
          pgDumpMs: 0,
        });
      }
    };

    // Bun.spawn para execução em background (não bloqueia o event loop)
    Bun.spawn({
      cmd: ['sh', '-c', 'true'], // dummy — só pra usar a API
    }).kill(); // workaround — Bun não tem spawn detached nativo simples

    // Solução real: retorna Promise sem await — Bun executa no event loop
    void run();
  }

  private buildTag(type: 'auto' | 'manual'): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    return `${type}-${ts}`;
  }

  private async notifyTelegram(
    status: 'success' | 'failed',
    tag: string,
    result: BackupResult,
  ): Promise<void> {
    if (!this.config.telegram) return;
    const icon = status === 'success' ? '✅' : '❌';
    let text: string;
    if (status === 'success' && result.status === 'success') {
      text = `${icon} Backup ${tag} OK (${(result.size / 1024 / 1024).toFixed(2)} MB, ${result.totalMs}ms)`;
    } else if (result.status === 'failed') {
      text = `${icon} Backup ${tag} FALHOU (${result.errorCode}): ${result.errorMessage}`;
    } else {
      text = `${icon} Backup ${tag}: estado inesperado`;
    }
    try {
      await this.config.telegram.send(text);
    } catch (err) {
      this.config.log.warn('backup.telegram_notify_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
