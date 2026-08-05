/**
 * Testes das funções de métrica do SDK: `countFlagChecks` (soma INCR
 * nos últimos 60 buckets).
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import RedisMock from 'ioredis-mock';
import { __resetFlagRedisForTesting, __setRedisFactoryForTesting, getFlagRedis } from './redis.ts';
import { buildFlagStatsKey } from './keys.ts';
import { countFlagChecks } from './metrics.ts';

describe('countFlagChecks', () => {
  beforeEach(() => {
    __resetFlagRedisForTesting();
  });

  afterEach(() => {
    __resetFlagRedisForTesting();
  });

  it('retorna 0 se Redis indisponível', async () => {
    const prev = process.env.REDIS_URL;
    try {
      delete process.env.REDIS_URL;
      expect(await countFlagChecks('maintenance_mode')).toBe(0);
    } finally {
      if (prev !== undefined) process.env.REDIS_URL = prev;
    }
  });

  it('soma buckets da última hora (60 minutos)', async () => {
    const mock = new RedisMock();
    __setRedisFactoryForTesting(() => mock as never);
    // Pre-warm: força a criação do singleton pelo factory (state compartilhado).
    getFlagRedis('redis://mock:6379');

    // Semear 3 buckets com valores conhecidos
    const now = Date.now();
    await mock.set(buildFlagStatsKey('maintenance_mode', now - 60_000), 5); // 1 min atrás
    await mock.set(buildFlagStatsKey('maintenance_mode', now - 1_200_000), 10); // 20 min atrás
    await mock.set(buildFlagStatsKey('maintenance_mode', now - 3_540_000), 8); // 59 min atrás

    const total = await countFlagChecks('maintenance_mode');
    expect(total).toBe(5 + 10 + 8);

    await mock.quit();
  });

  it('ignora chave de outro flag key', async () => {
    const mock = new RedisMock();
    __setRedisFactoryForTesting(() => mock as never);
    getFlagRedis('redis://mock:6379');

    // Usa keys únicos (timestamp) para isolar do estado compartilhado entre testes.
    const uniqueKey = `test-ignora-outro-flag-${Date.now()}`;
    const now = Date.now();
    await mock.set(buildFlagStatsKey(uniqueKey, now), 100);
    await mock.set(buildFlagStatsKey(uniqueKey + '-other', now), 999);

    expect(await countFlagChecks(uniqueKey)).toBe(100);
    expect(await countFlagChecks(uniqueKey + '-other')).toBe(999);

    await mock.quit();
  });

  it('retorna 0 quando buckets não existem', async () => {
    const mock = new RedisMock();
    __setRedisFactoryForTesting(() => mock as never);
    getFlagRedis('redis://mock:6379');
    // Key única garante isolamento entre testes.
    const uniqueKey = `test-buckets-vazios-${Date.now()}`;
    expect(await countFlagChecks(uniqueKey)).toBe(0);
    await mock.quit();
  });

  it('valores nulos viram 0', async () => {
    const mock = new RedisMock();
    __setRedisFactoryForTesting(() => mock as never);
    getFlagRedis('redis://mock:6379');

    // Key única garante que nenhum bucket pré-existente infle o total.
    const uniqueKey = `test-valores-nulos-${Date.now()}`;
    const now = Date.now();
    await mock.set(buildFlagStatsKey(uniqueKey, now - 30_000), '');
    await mock.set(buildFlagStatsKey(uniqueKey, now - 120_000), 'abc');

    const total = await countFlagChecks(uniqueKey);
    expect(total).toBe(0);

    await mock.quit();
  });
});
