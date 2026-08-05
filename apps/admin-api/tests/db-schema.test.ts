/**
 * Teste de integração real contra Postgres do Contabo.
 *
 * Roda migrations, faz CRUD no BackupsRepository, depois drop o schema.
 * Requer:
 *   - docker compose up -d postgres (no VPS, exposto em 127.0.0.1:5446)
 *   - TEST_POSTGRES_PASSWORD=... (env)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { migrateAdminDb } from '../src/db/runner.ts';
import { createAdminDb } from '../src/db/db.ts';
import { BackupsRepository } from '../src/backup/backup-repository.ts';

const PASSWORD = process.env['TEST_POSTGRES_PASSWORD'];
if (!PASSWORD) {
  throw new Error('TEST_POSTGRES_PASSWORD required');
}

const host = 'localhost';
const port = 15446;
const user = 'evolution';
const database = 'omestre_db';

const adminClient = postgres({ host, port, user, password: PASSWORD, database });
const appDb = createAdminDb({
  host,
  port,
  user,
  password: PASSWORD,
  database,
  schema: 'omestre_admin',
});

beforeAll(async () => {
  await adminClient`DROP SCHEMA IF EXISTS omestre_admin CASCADE`;
  await migrateAdminDb(appDb);
});

afterAll(async () => {
  await adminClient`DROP SCHEMA IF EXISTS omestre_admin CASCADE`;
  await adminClient.end();
  // @ts-ignore
  await appDb.$client.end();
});

describe('Schema omestre_admin', () => {
  test('schema foi criado', async () => {
    const rows =
      await adminClient`SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'omestre_admin'`;
    expect(rows).toHaveLength(1);
  });

  test('tabelas principais existem', async () => {
    const tables =
      await adminClient`SELECT tablename FROM pg_tables WHERE schemaname = 'omestre_admin' ORDER BY tablename`;
    const names = tables.map((r: any) => r.tablename);
    expect(names).toContain('backup');
    expect(names).toContain('deployment');
    expect(names).toContain('audit_log');
    expect(names).toContain('session');
    expect(names).toContain('alert');
    expect(names).toContain('health_check');
  });

  test('enums criados', async () => {
    const enums =
      await adminClient`SELECT typname FROM pg_type WHERE typname LIKE 'omestre_admin_%' ORDER BY typname`;
    const names = enums.map((r: any) => r.typname);
    expect(names).toContain('omestre_admin_backup_type');
    expect(names).toContain('omestre_admin_backup_status');
    expect(names).toContain('omestre_admin_deployment_status');
    expect(names).toContain('omestre_admin_audit_status');
  });
});

describe('BackupsRepository CRUD', () => {
  test('createPending + findByTag', async () => {
    const repo = new BackupsRepository(appDb);
    const tag = `test-int-create-${Date.now()}`;
    const row = await repo.createPending({
      tag,
      type: 'manual',
      schemas: ['omestre', 'evolution_api'],
      createdBy: 'integration-test',
    });
    expect(row.tag).toBe(tag);
    expect(row.status).toBe('pending');
    const found = await repo.findByTag(tag);
    expect(found?.id).toBe(row.id);
    expect(found?.type).toBe('manual');
    expect(found?.schemas).toBe('omestre,evolution_api');
  });

  test('markRunning muda status', async () => {
    const repo = new BackupsRepository(appDb);
    const tag = `test-int-running-${Date.now()}`;
    await repo.createPending({ tag, type: 'auto', schemas: ['omestre'], createdBy: 't' });
    await repo.markRunning(tag);
    const row = await repo.findByTag(tag);
    expect(row?.status).toBe('running');
  });

  test('markDeleted e soft delete', async () => {
    const repo = new BackupsRepository(appDb);
    const tag = `test-int-deleted-${Date.now()}`;
    await repo.createPending({ tag, type: 'manual', schemas: ['omestre'], createdBy: 't' });
    await repo.markDeleted(tag);
    const row = await repo.findByTag(tag);
    expect(row?.status).toBe('deleted');
    expect(row).not.toBeNull();
  });

  test('findAll respeita ordenacao DESC started_at', async () => {
    const repo = new BackupsRepository(appDb);
    const all = await repo.findAll(100);
    expect(all.length).toBeGreaterThan(0);
    if (all.length >= 2) {
      const ts1 = new Date(all[0]!.startedAt).getTime();
      const ts2 = new Date(all[1]!.startedAt).getTime();
      expect(ts1).toBeGreaterThanOrEqual(ts2);
    }
  });

  test('getStats retorna agregados', async () => {
    const repo = new BackupsRepository(appDb);
    const stats = await repo.getStats();
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.successLast7d).toBeGreaterThanOrEqual(0);
    expect(stats.failedLast7d).toBeGreaterThanOrEqual(0);
    expect(stats.totalSizeBytes).toBeGreaterThanOrEqual(0);
  });
});
