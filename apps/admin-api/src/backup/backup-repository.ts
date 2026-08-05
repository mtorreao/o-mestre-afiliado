import { desc, eq } from 'drizzle-orm';
import { backup, type Backup, type NewBackup } from '../db/schema.ts';
import type { AdminDb } from '../db/db.ts';
import type { BackupResult } from './backup-writer.ts';

/**
 * BackupsRepository — persistência do ciclo de vida de backups.
 *
 * Fluxo:
 *   1. `createPending()` antes de iniciar — registra intenção
 *   2. `markRunning()` quando o BackupWriter começa
 *   3. `markSuccess()` / `markFailed()` ao final
 *   4. `findAll()` / `findById()` para UI
 *
 * Tudo idempotente na tag (unique constraint). Re-execução sobrescreve
 * o registro existente (UPSERT semântico).
 */
export class BackupsRepository {
  constructor(private readonly db: AdminDb) {}

  /** Cria registro inicial (status: pending). Retorna row criada. */
  async createPending(input: {
    tag: string;
    type: 'auto' | 'manual';
    schemas: string[];
    createdBy: string;
  }): Promise<Backup> {
    const startedAt = new Date();
    const row: NewBackup = {
      tag: input.tag,
      type: input.type,
      status: 'pending',
      schemas: input.schemas.join(','),
      createdBy: input.createdBy,
      startedAt,
    };
    const [inserted] = await this.db.insert(backup).values(row).returning();
    if (!inserted) throw new Error('createPending: failed to insert');
    return inserted;
  }

  /** Marca como running (janela entre pending → execução de fato). */
  async markRunning(tag: string): Promise<void> {
    await this.db.update(backup).set({ status: 'running' }).where(eq(backup.tag, tag));
  }

  /** Sucesso — popula campos de métricas + R2. */
  async markSuccess(
    tag: string,
    fields: Extract<BackupResult, { status: 'success' }>,
  ): Promise<void> {
    await this.db
      .update(backup)
      .set({
        status: 'success',
        r2Key: fields.r2Key,
        sha256: fields.sha256,
        sizeBytes: fields.size,
        ciphertextSize: fields.ciphertextSize,
        pgDumpMs: fields.pgDumpMs,
        encryptMs: fields.encryptMs,
        uploadMs: fields.uploadMs,
        totalMs: fields.totalMs,
        finishedAt: new Date(),
      })
      .where(eq(backup.tag, tag));
  }

  /** Falha — popula código + mensagem. */
  async markFailed(
    tag: string,
    fields: Extract<BackupResult, { status: 'failed' }>,
  ): Promise<void> {
    await this.db
      .update(backup)
      .set({
        status: 'failed',
        errorCode: fields.errorCode,
        errorMessage: fields.errorMessage,
        pgDumpMs: fields.pgDumpMs,
        finishedAt: new Date(),
      })
      .where(eq(backup.tag, tag));
  }

  /** Lista os últimos N backups (ordenados por started_at DESC). */
  async findAll(limit = 50): Promise<Backup[]> {
    return this.db.select().from(backup).orderBy(desc(backup.startedAt)).limit(limit);
  }

  /** Busca um backup específico por tag. */
  async findByTag(tag: string): Promise<Backup | null> {
    const [row] = await this.db.select().from(backup).where(eq(backup.tag, tag)).limit(1);
    return row ?? null;
  }

  /** Busca por ID interno. */
  async findById(id: number): Promise<Backup | null> {
    const [row] = await this.db.select().from(backup).where(eq(backup.id, id)).limit(1);
    return row ?? null;
  }

  /** Marca como deleted (soft delete — mantém histórico). */
  async markDeleted(tag: string): Promise<void> {
    await this.db
      .update(backup)
      .set({ status: 'deleted', finishedAt: new Date() })
      .where(eq(backup.tag, tag));
  }

  /** Stats agregadas para a UI. */
  async getStats(): Promise<{
    total: number;
    successLast7d: number;
    failedLast7d: number;
    totalSizeBytes: number;
  }> {
    const rows = await this.findAll(1000);
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let success7d = 0;
    let failed7d = 0;
    let totalSize = 0;
    for (const r of rows) {
      if (r.status === 'success') {
        totalSize += r.sizeBytes ?? 0;
        if (r.startedAt && new Date(r.startedAt).getTime() > cutoff) success7d += 1;
      } else if (r.status === 'failed') {
        if (r.startedAt && new Date(r.startedAt).getTime() > cutoff) failed7d += 1;
      }
    }
    return {
      total: rows.length,
      successLast7d: success7d,
      failedLast7d: failed7d,
      totalSizeBytes: totalSize,
    };
  }
}
