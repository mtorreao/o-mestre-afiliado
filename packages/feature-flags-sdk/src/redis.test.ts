/**
 * Testes do singleton lazy Redis do SDK.
 *
 * Usa `ioredis-mock` injetado via `__setRedisFactoryForTesting`.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import RedisMock from 'ioredis-mock';
import { getFlagRedis, __resetFlagRedisForTesting, __setRedisFactoryForTesting } from './redis.ts';

describe('getFlagRedis', () => {
  afterEach(() => {
    __resetFlagRedisForTesting();
  });

  it('retorna o mesmo singleton em chamadas repetidas', () => {
    __setRedisFactoryForTesting(() => new RedisMock() as never);
    const a = getFlagRedis('redis://test:6379');
    const b = getFlagRedis('redis://test:6379');
    expect(a).not.toBeNull();
    expect(a).toBe(b);
  });

  it('retorna null se redisUrl ausente e env vazio', () => {
    const prev = process.env.REDIS_URL;
    try {
      delete process.env.REDIS_URL;
      expect(getFlagRedis()).toBeNull();
    } finally {
      if (prev !== undefined) process.env.REDIS_URL = prev;
      __resetFlagRedisForTesting();
    }
  });

  it('fallback silencioso se factory lança', () => {
    __setRedisFactoryForTesting(() => {
      throw new Error('redis indisponível');
    });
    expect(getFlagRedis('redis://x:6379')).toBeNull();
    __resetFlagRedisForTesting();
  });

  it('factory mock funciona contra ioredis-mock', async () => {
    __setRedisFactoryForTesting(() => new RedisMock() as never);
    const r = getFlagRedis('redis://mock:6379');
    expect(r).not.toBeNull();
    // smoke test da API ioredis via mock
    await r!.set('test-key', 'hello');
    expect(await r!.get('test-key')).toBe('hello');
  });

  it('mock spy do factory é chamado uma vez (lazy)', () => {
    const factoryMock = mock(() => new RedisMock() as never);
    __setRedisFactoryForTesting(factoryMock);
    getFlagRedis('redis://test:6379');
    getFlagRedis('redis://test:6379');
    getFlagRedis('redis://test:6379');
    expect(factoryMock).toHaveBeenCalledTimes(1);
  });
});
