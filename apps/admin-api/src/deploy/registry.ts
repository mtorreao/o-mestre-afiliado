/**
 * Registro de deploys — persistência local (JSON).
 *
 * Salva histórico + log completo no `<stateDir>/deployments.json`, no
 * volume nomeado `oma_admin_state` do docker compose. Sobrevive a restart
 * do container sem dependência externa.
 *
 * Top 100 registros (mais recentes) — evita arquivo gigante em deploys
 * longos com stdout verboso.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from '../config.ts';

export type DeployStatus = 'running' | 'success' | 'failed' | 'timeout';

export interface DeployRecord {
  id: string;
  ref: string; // tag ou branch (ex: v0.4.2)
  sha: string; // commit sha curto
  triggeredBy: string; // 'github' | 'manual'
  status: DeployStatus;
  startedAt: string; // ISO
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  logBody: string | null; // stdout + stderr concatenados (pode ser null para deploys rodando)
  summary: string; // linha curta de resumo (erro ou "ok")
}

export interface DeployRegistry {
  list(): Promise<DeployRecord[]>;
  get(id: string): Promise<DeployRecord | null>;
  create(
    record: Omit<DeployRecord, 'startedAt' | 'finishedAt' | 'durationMs'>,
  ): Promise<DeployRecord>;
  update(id: string, patch: Partial<DeployRecord>): Promise<DeployRecord | null>;
}

export function makeDeployRegistry(stateDir: string, log: Logger): DeployRegistry {
  const file = join(stateDir, 'deployments.json');

  async function readAll(): Promise<DeployRecord[]> {
    try {
      const raw = await readFile(file, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed as DeployRecord[];
      return [];
    } catch {
      return [];
    }
  }

  async function writeAll(records: DeployRecord[]): Promise<void> {
    await mkdir(stateDir, { recursive: true });
    await writeFile(file, JSON.stringify(records, null, 2), 'utf8');
  }

  return {
    async list() {
      const records = await readAll();
      // Mais recente primeiro.
      return records.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
    },

    async get(id) {
      const records = await readAll();
      return records.find((r) => r.id === id) ?? null;
    },

    async create(record) {
      const records = await readAll();
      const now = new Date().toISOString();
      const full: DeployRecord = {
        ...record,
        startedAt: now,
        finishedAt: null,
        durationMs: null,
      };
      records.push(full);
      // Mantém só os últimos 100 (evita arquivo gigante).
      await writeAll(records.slice(-100));
      log.info('registro de deploy criado', { id: full.id, ref: full.ref });
      return full;
    },

    async update(id, patch) {
      const records = await readAll();
      const idx = records.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const updated: DeployRecord = { ...records[idx]!, ...patch };
      records[idx] = updated;
      await writeAll(records);
      log.info('registro de deploy atualizado', { id, status: updated.status });
      return updated;
    },
  };
}
