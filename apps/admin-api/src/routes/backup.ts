/**
 * Routes /api/backups/* — CRUD e operações de backup.
 *
 * Mounted em `/api/admin` (no index.ts), portanto URL final:
 *   /api/admin/backups
 *
 * Endpoints:
 *   POST   /backups/run         → inicia backup (manual ou cron); 202 Accepted
 *   GET    /backups              → lista (paginated, default 50)
 *   GET    /backups/:id          → detalhe (polling do cliente)
 *   GET    /backups/:id/download → signed URL do R2 (TTL 5min)
 *   DELETE /backups/:id          → soft delete (status='deleted')
 *   GET    /backups/stats        → agregados (totais, success/failed 7d)
 *
 * Auth: sessionAuth (middleware). Audit log + Telegram notify ocorrem
 * dentro do BackupOrchestrator, não aqui.
 */
import { Hono } from 'hono';
import type { Logger } from '../config.ts';
import { sessionAuth, type AuthEnv } from '../auth.ts';
import { BackupsRepository } from '../backup/backup-repository.ts';
import type { Backup } from '../db/schema.ts';
import { BackupOrchestrator } from '../backup/backup-orchestrator.ts';
import type { R2Client } from '@omestre/r2-sdk';

export interface BackupRoutesDeps {
  log: Logger;
  repo: BackupsRepository;
  orchestrator: BackupOrchestrator;
  r2: R2Client;
}

export function backupRoutes(deps: BackupRoutesDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use('*', sessionAuth());

  // POST /api/admin/backups/run
  app.post('/run', async (c) => {
    const actor = c.get('authUser') ?? 'unknown';
    const overrideType = c.req.query('type');
    const type: 'auto' | 'manual' = overrideType === 'manual' ? 'manual' : 'auto';

    const result = await deps.orchestrator.trigger({ type, actor });
    deps.log.info('backup.trigger', { tag: result.tag, type, actor });
    return c.json({ success: true, ...result }, 202);
  });

  // GET /api/admin/backups
  app.get('/', async (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
    const rows = await deps.repo.findAll(limit);
    return c.json({ success: true, backups: rows.map(serializeBackup), total: rows.length });
  });

  // GET /api/admin/backups/stats
  app.get('/stats', async (c) => {
    const stats = await deps.repo.getStats();
    return c.json({ success: true, ...stats });
  });

  // GET /api/admin/backups/:id
  app.get('/:id', async (c) => {
    const id = parseIdParam(c.req.param('id'));
    if (id === null) return c.json({ success: false, error: 'invalid id' }, 400);
    const row = await deps.repo.findById(id);
    if (!row) return c.json({ success: false, error: 'not found' }, 404);
    return c.json({ success: true, backup: serializeBackup(row) });
  });

  // GET /api/admin/backups/:id/download
  app.get('/:id/download', async (c) => {
    const id = parseIdParam(c.req.param('id'));
    if (id === null) return c.json({ success: false, error: 'invalid id' }, 400);
    const row = await deps.repo.findById(id);
    if (!row) return c.json({ success: false, error: 'not found' }, 404);
    if (!row.r2Key) return c.json({ success: false, error: 'no r2 key (backup failed)' }, 409);
    if (row.status !== 'success')
      return c.json({ success: false, error: 'backup not in success state' }, 409);

    const url = await deps.r2.signedUrl(row.r2Key, 300);
    const actor = c.get('authUser') ?? 'unknown';
    deps.log.info('backup.download', { tag: row.tag, actor });
    return c.json({ success: true, url, expiresIn: 300 });
  });

  // DELETE /api/admin/backups/:id
  app.delete('/:id', async (c) => {
    const id = parseIdParam(c.req.param('id'));
    if (id === null) return c.json({ success: false, error: 'invalid id' }, 400);
    const row = await deps.repo.findById(id);
    if (!row) return c.json({ success: false, error: 'not found' }, 404);
    await deps.repo.markDeleted(row.tag);
    const actor = c.get('authUser') ?? 'unknown';
    deps.log.info('backup.delete', { tag: row.tag, actor });
    return c.json({ success: true, deleted: true });
  });

  return app;
}

/* ─── Helpers ──────────────────────────────────────────────────────────── */

function parseIdParam(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

function serializeBackup(row: Backup): unknown {
  return {
    id: row.id,
    tag: row.tag,
    type: row.type,
    status: row.status,
    schemas: row.schemas.split(',').filter(Boolean),
    r2Key: row.r2Key,
    sha256: row.sha256,
    sizeBytes: row.sizeBytes,
    ciphertextSize: row.ciphertextSize,
    durations: {
      pgDump: row.pgDumpMs,
      encrypt: row.encryptMs,
      upload: row.uploadMs,
      total: row.totalMs,
    },
    error: row.status === 'failed' ? { code: row.errorCode, message: row.errorMessage } : null,
    createdBy: row.createdBy,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}
