/**
 * Testes das rotas /api/admin/backups/* (Hono app + mocks).
 *
 * Não toca Postgres real — usa um repo fake in-memory e um
 * R2Client fake. Valida auth, serialização e status codes.
 */
import { describe, expect, test, mock } from 'bun:test';
import { Hono } from 'hono';
import type { Logger } from '../config.ts';
import { backupRoutes } from '../routes/backup.ts';
import { BackupOrchestrator } from '../backup/backup-orchestrator.ts';
import type { R2Client } from '@omestre/r2-sdk';
import { type AuthEnv } from '../auth.ts';

// Mock do sessionAuth: aceita qualquer Bearer token e seta authUser.
mock.module('../auth.ts', () => {
  const sessionAuth = () => async (c: any, next: any) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }
    c.set('authUser', 'admin');
    await next();
  };
  return { sessionAuth };
});

/* ─── Fakes ───────────────────────────────────────────────────────────── */

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const fakeR2: R2Client = {
  put: async () => ({ etag: 'e', size: 0 }),
  get: async () => ({ body: Buffer.from(''), size: 0, metadata: {} }),
  delete: async () => {},
  list: async () => [],
  signedUrl: async (key: string) => `https://signed.example/${key}?sig=test`,
  ping: async () => true,
} as unknown as R2Client;

interface FakeRow {
  id: number;
  tag: string;
  type: 'auto' | 'manual';
  status: 'pending' | 'running' | 'success' | 'failed' | 'deleted';
  schemas: string;
  r2Key: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  ciphertextSize: number | null;
  pgDumpMs: number | null;
  encryptMs: number | null;
  uploadMs: number | null;
  totalMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdBy: string;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
}

class FakeRepo {
  rows: FakeRow[] = [];
  nextId = 1;

  async createPending(input: {
    tag: string;
    type: 'auto' | 'manual';
    schemas: string[];
    createdBy: string;
  }) {
    const row: FakeRow = {
      id: this.nextId++,
      tag: input.tag,
      type: input.type,
      status: 'pending',
      schemas: input.schemas.join(','),
      r2Key: null,
      sha256: null,
      sizeBytes: null,
      ciphertextSize: null,
      pgDumpMs: null,
      encryptMs: null,
      uploadMs: null,
      totalMs: null,
      errorCode: null,
      errorMessage: null,
      createdBy: input.createdBy,
      startedAt: new Date(),
      finishedAt: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async findAll(limit = 50) {
    return [...this.rows].reverse().slice(0, limit);
  }

  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findByTag(tag: string) {
    return this.rows.find((r) => r.tag === tag) ?? null;
  }

  async markRunning(tag: string) {
    const r = this.rows.find((x) => x.tag === tag);
    if (r) r.status = 'running';
  }

  async markSuccess(tag: string) {
    const r = this.rows.find((x) => x.tag === tag);
    if (r) r.status = 'success';
  }

  async markFailed(tag: string) {
    const r = this.rows.find((x) => x.tag === tag);
    if (r) r.status = 'failed';
  }

  async markDeleted(tag: string) {
    const r = this.rows.find((x) => x.tag === tag);
    if (r) r.status = 'deleted';
  }

  async getStats() {
    return { total: this.rows.length, successLast7d: 0, failedLast7d: 0, totalSizeBytes: 0 };
  }
}

class FakeOrchestrator {
  calls: { type: 'auto' | 'manual'; actor: string }[] = [];
  constructor(private repo: FakeRepo) {}

  async trigger(input: { type: 'auto' | 'manual'; actor: string }) {
    this.calls.push(input);
    const row = await this.repo.createPending({
      tag: `${input.type}-${Date.now()}`,
      type: input.type,
      schemas: ['omestre', 'evolution_api'],
      createdBy: input.actor,
    });
    return {
      id: row.id,
      tag: row.tag,
      status: 'pending' as const,
      statusUrl: `/api/backups/${row.id}`,
    };
  }
}

/* ─── Setup ───────────────────────────────────────────────────────────── */

function makeApp(repo: FakeRepo) {
  const app = new Hono<AuthEnv>();
  // Auth é coberto pelo mock.module('../auth.ts') — sessionAuth aceita
  // qualquer Bearer token.
  app.route(
    '/api/admin/backups',
    backupRoutes({
      log: silentLog,
      repo: repo as never,
      orchestrator: new FakeOrchestrator(repo) as never,
      r2: fakeR2,
    }),
  );
  return app;
}

/* ─── Tests ───────────────────────────────────────────────────────────── */

describe('POST /api/admin/backups/run', () => {
  test('sem token → 401', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/run', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  test('com token → 202 + id/tag/statusUrl', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.id).toBe(1);
    expect(body.status).toBe('pending');
    expect(body.statusUrl).toBe('/api/backups/1');
    expect(repo.rows).toHaveLength(1);
    expect(repo.rows[0]!.createdBy).toBe('admin');
  });

  test('?type=manual força manual', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/run?type=manual', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as any;
    expect(body.tag.startsWith('manual-')).toBe(true);
  });
});

describe('GET /api/admin/backups', () => {
  test('lista backups (vazio → 200 com array vazio)', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.backups).toEqual([]);
  });

  test('lista com 1 registro após trigger', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    await app.request('/api/admin/backups/run', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token' },
    });
    const res = await app.request('/api/admin/backups', {
      headers: { Authorization: 'Bearer test-token' },
    });
    const body = (await res.json()) as any;
    expect(body.backups).toHaveLength(1);
    expect(body.backups[0]!.id).toBe(1);
    expect(body.backups[0]!.status).toBe('pending');
    expect(body.backups[0]!.schemas).toEqual(['omestre', 'evolution_api']);
  });
});

describe('GET /api/admin/backups/:id', () => {
  test('id inexistente → 404', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/999', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(404);
  });

  test('id inválido → 400', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/abc', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/admin/backups/:id/download', () => {
  test('backup pending sem r2Key → 409', async () => {
    const repo = new FakeRepo();
    await repo.createPending({
      tag: 'auto-x',
      type: 'auto',
      schemas: ['omestre'],
      createdBy: 'admin',
    });
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/1/download', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(409);
  });

  test('backup success com r2Key → 200 + signed url', async () => {
    const repo = new FakeRepo();
    const row = await repo.createPending({
      tag: 'auto-y',
      type: 'auto',
      schemas: ['omestre'],
      createdBy: 'admin',
    });
    row.status = 'success';
    row.r2Key = 'auto/2026.sql.gz.age';
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/1/download', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.url).toContain('signed.example');
    expect(body.expiresIn).toBe(300);
  });
});

describe('DELETE /api/admin/backups/:id', () => {
  test('soft delete → status deleted', async () => {
    const repo = new FakeRepo();
    await repo.createPending({
      tag: 'auto-z',
      type: 'auto',
      schemas: ['omestre'],
      createdBy: 'admin',
    });
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/1', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.deleted).toBe(true);
    expect(repo.rows[0]!.status).toBe('deleted');
  });
});

describe('GET /api/admin/backups/stats', () => {
  test('retorna agregados', async () => {
    const repo = new FakeRepo();
    const app = makeApp(repo);
    const res = await app.request('/api/admin/backups/stats', {
      headers: { Authorization: 'Bearer test-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBe(0);
    expect(body.successLast7d).toBe(0);
    expect(body.failedLast7d).toBe(0);
    expect(body.totalSizeBytes).toBe(0);
  });
});
