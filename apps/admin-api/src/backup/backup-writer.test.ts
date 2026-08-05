import { describe, expect, test } from 'bun:test';
import { BackupWriter } from './backup-writer.ts';
import type { PgDumpResult } from './postgres-dump-pure.ts';
import type { R2Client, R2PutResult } from '@omestre/r2-sdk';

const PUB_KEY = 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p';

function fakeR2(
  putImpl: (key: string, body: Uint8Array) => Promise<R2PutResult> = async () => ({
    etag: 'fake',
    size: 0,
  }),
): R2Client {
  return {
    put: putImpl,
  } as unknown as R2Client;
}

function fakePgDump(
  dump: Omit<PgDumpResult, 'durationMs'>,
): typeof import('./postgres-dump-pure.ts').runPgDump {
  return async () => ({ ...dump, durationMs: 50 });
}

const writerDeps = (runPgDump: typeof import('./postgres-dump-pure.ts').runPgDump) => ({
  runPgDump,
});

describe('BackupWriter.run', () => {
  test('happy path: dump -> encrypt -> upload', async () => {
    const dump = Buffer.from('binary postgres dump data');
    let uploadedKey = '';
    let uploadedBody: Uint8Array | null = null;

    const writer = new BackupWriter(
      {
        r2: fakeR2(async (key, body) => {
          uploadedKey = key;
          uploadedBody = body;
          return { etag: 'abc123', size: body.byteLength };
        }),
        agePublicKey: PUB_KEY,
        postgres: {
          container: 'omestre_postgres',
          dbUser: 'evolution',
          dbName: 'omestre_db',
          schemas: ['omestre', 'evolution_api'],
        },
        actor: 'test',
      },
      writerDeps(fakePgDump({ data: dump, size: dump.byteLength })),
    );

    const result = await writer.run('auto');

    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('unreachable');

    expect(result.type).toBe('auto');
    expect(result.size).toBe(dump.byteLength);
    expect(result.sha256).toHaveLength(64);
    expect(result.pgDumpMs).toBeGreaterThanOrEqual(0);
    expect(result.encryptMs).toBeGreaterThanOrEqual(0);
    expect(result.uploadMs).toBeGreaterThanOrEqual(0);
    expect(result.totalMs).toBeGreaterThanOrEqual(0);

    expect(uploadedKey).toBe(result.r2Key);
    expect(uploadedKey.startsWith('auto/')).toBe(true);
    expect(uploadedKey.endsWith('.sql.gz.age')).toBe(true);
    expect(uploadedKey).toContain('__omestre,evolution_api');

    expect(uploadedBody).not.toBeNull();
    expect(uploadedBody!.byteLength).toBeGreaterThan(dump.byteLength);
    expect(Buffer.compare(uploadedBody!, dump)).not.toBe(0);
  });

  test('falha quando pg_dump joga erro', async () => {
    const writer = new BackupWriter(
      {
        r2: fakeR2(),
        agePublicKey: PUB_KEY,
        postgres: {
          container: 'omestre_postgres',
          dbUser: 'evolution',
          dbName: 'omestre_db',
          schemas: ['omestre', 'evolution_api'],
        },
        actor: 'test',
      },
      {
        runPgDump: async () => {
          throw new Error('pg_dump failed (exit 1): connection refused');
        },
      },
    );

    const result = await writer.run('auto');

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.errorCode).toBe('pg_dump_failed');
    expect(result.errorMessage).toContain('connection refused');
    expect(result.r2Key).toContain('FAILED');
  });

  test('falha quando R2.put joga erro', async () => {
    const dump = Buffer.from('dump data');
    const writer = new BackupWriter(
      {
        r2: fakeR2(async () => {
          throw new Error('R2 PUT failed: 403 Forbidden');
        }),
        agePublicKey: PUB_KEY,
        postgres: {
          container: 'omestre_postgres',
          dbUser: 'evolution',
          dbName: 'omestre_db',
          schemas: ['omestre', 'evolution_api'],
        },
        actor: 'test',
      },
      writerDeps(fakePgDump({ data: dump, size: dump.byteLength })),
    );

    const result = await writer.run('manual');

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.errorCode).toBe('r2_upload_failed');
    expect(result.r2Key).toContain('manual/');
  });

  test('falha quando age public key é inválida', async () => {
    const dump = Buffer.from('dump data');
    const writer = new BackupWriter(
      {
        r2: fakeR2(),
        agePublicKey: 'invalid-key',
        postgres: {
          container: 'omestre_postgres',
          dbUser: 'evolution',
          dbName: 'omestre_db',
          schemas: ['omestre', 'evolution_api'],
        },
        actor: 'test',
      },
      writerDeps(fakePgDump({ data: dump, size: dump.byteLength })),
    );

    const result = await writer.run('auto');

    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('unreachable');
    expect(result.errorCode).toBe('invalid_age_public_key');
  });

  test('chave gerada é determinística com base no sha256', async () => {
    const dump = Buffer.from('A'.repeat(100));
    let capturedKey = '';
    const writer = new BackupWriter(
      {
        r2: fakeR2(async (key) => {
          capturedKey = key;
          return { etag: 'a', size: 0 };
        }),
        agePublicKey: PUB_KEY,
        postgres: {
          container: 'omestre_postgres',
          dbUser: 'evolution',
          dbName: 'omestre_db',
          schemas: ['omestre'],
        },
        actor: 'test',
      },
      writerDeps(fakePgDump({ data: dump, size: dump.byteLength })),
    );

    const r1 = await writer.run('auto');
    const r2 = await writer.run('auto');

    if (r1.status !== 'success' || r2.status !== 'success') {
      throw new Error('unreachable');
    }
    expect(capturedKey).toMatch(/^auto\/.+__.+__.+\.sql\.gz\.age$/);
    expect(r1.sha256).toBe(r2.sha256);
  });
});
