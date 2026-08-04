/**
 * Testes do registry de deploys (persistência JSON local).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeDeployRegistry, type DeployRecord } from './registry.ts';
import type { Logger } from '../config.ts';

const silentLog: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const baseRecord = {
  triggeredBy: 'github',
  status: 'running' as const,
  exitCode: null,
  logBody: null,
  summary: 'deploy iniciado',
};

describe('DeployRegistry', () => {
  let dir: string;
  let registry: ReturnType<typeof makeDeployRegistry>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'oma-registry-'));
    registry = makeDeployRegistry(dir, silentLog);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('create adiciona startedAt e status running', async () => {
    const record = await registry.create({
      id: 'abc',
      ref: 'v0.4.2',
      sha: '954d94b',
      ...baseRecord,
    });
    expect(record.startedAt).toBeTruthy();
    expect(record.finishedAt).toBeNull();
    expect(record.durationMs).toBeNull();
  });

  test('update altera status e campos', async () => {
    await registry.create({ id: 'abc', ref: 'v0.4.2', sha: '954d94b', ...baseRecord });
    const updated = await registry.update('abc', {
      status: 'success',
      finishedAt: new Date().toISOString(),
      durationMs: 4200,
      exitCode: 0,
      logBody: 'Deploy v0.4.2 — success\n───── STDOUT ─────\nok\n',
      summary: 'ok',
    });
    expect(updated?.status).toBe('success');
    expect(updated?.durationMs).toBe(4200);
    expect(updated?.logBody).toContain('ok');
    expect(updated?.summary).toBe('ok');
  });

  test('get retorna null para id inexistente', async () => {
    expect(await registry.get('nao-existe')).toBeNull();
  });

  test('persistência sobrevive a nova instância (mesmo diretório)', async () => {
    await registry.create({ id: 'abc', ref: 'v0.4.2', sha: '954d94b', ...baseRecord });
    const registry2 = makeDeployRegistry(dir, silentLog);
    const list = await registry2.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe('abc');
  });

  test('list ordena mais recente primeiro', async () => {
    await registry.create({ id: '1', ref: 'v0.4.0', sha: 'aaa', ...baseRecord });
    await new Promise((r) => setTimeout(r, 5));
    await registry.create({ id: '2', ref: 'v0.4.1', sha: 'bbb', ...baseRecord });
    const list = await registry.list();
    expect(list[0]?.id).toBe('2');
    expect(list[1]?.id).toBe('1');
  });

  test('mantém apenas os últimos 100 registros', async () => {
    for (let i = 0; i < 105; i++) {
      await registry.create({ id: `id-${i}`, ref: `v0.0.${i}`, sha: 'x', ...baseRecord });
    }
    const list = await registry.list();
    expect(list).toHaveLength(100);
  });

  test('update em id inexistente retorna null', async () => {
    const result = await registry.update('nao-existe', { status: 'success' });
    expect(result).toBeNull();
  });

  test('arquivo corrompido → lista vazia sem throw', async () => {
    await writeFile(join(dir, 'deployments.json'), '{{{{json-invalido', 'utf8');
    const list = await registry.list();
    expect(list).toEqual([]);
  });

  test('logBody null para deploy rodando; string quando termina', async () => {
    const r1 = await registry.create({
      id: 'a',
      ref: 'v1',
      sha: '1',
      ...baseRecord,
      logBody: null,
    });
    expect(r1.logBody).toBeNull();

    const r2 = await registry.create({
      id: 'b',
      ref: 'v2',
      sha: '2',
      ...baseRecord,
      logBody: 'stdout completo aqui',
    });
    expect(r2.logBody).toBe('stdout completo aqui');
  });
});

// Garante que o tipo DeployRecord é exportado (compile-time).
void (0 as unknown as DeployRecord);
