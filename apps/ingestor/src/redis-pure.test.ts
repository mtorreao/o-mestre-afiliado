/**
 * Testes das funções PURAS em apps/ingestor/src/redis-pure.ts.
 *
 * Cobrem 100% do cálculo do backoff de retry do Redis (`redisRetryDelay`),
 * sem conexão de rede. A construção do client (`getRedis` em `redis.ts`)
 * depende de I/O e fica fora do escopo.
 */
import { describe, expect, it } from 'bun:test';
import { redisRetryDelay, REDIS_RETRY_MAX_MS, REDIS_RETRY_BASE_MS } from './redis-pure.ts';

describe('redisRetryDelay', () => {
  it('cresce linearmente (times * 200)', () => {
    expect(redisRetryDelay(1)).toBe(REDIS_RETRY_BASE_MS * 1);
    expect(redisRetryDelay(2)).toBe(REDIS_RETRY_BASE_MS * 2);
    expect(redisRetryDelay(5)).toBe(REDIS_RETRY_BASE_MS * 5);
  });

  it('respeita o teto de 5000ms', () => {
    expect(REDIS_RETRY_MAX_MS).toBe(5000);
    expect(redisRetryDelay(50)).toBe(REDIS_RETRY_MAX_MS);
    expect(redisRetryDelay(1000)).toBe(REDIS_RETRY_MAX_MS);
  });

  it('atinge exatamente o teto na fronteira (times=25 → 5000)', () => {
    expect(redisRetryDelay(Math.ceil(REDIS_RETRY_MAX_MS / REDIS_RETRY_BASE_MS))).toBe(
      REDIS_RETRY_MAX_MS,
    );
  });

  it('nunca ultrapassa o teto', () => {
    for (let t = 1; t <= 100; t++) {
      expect(redisRetryDelay(t)).toBeLessThanOrEqual(REDIS_RETRY_MAX_MS);
    }
  });

  it('é determinístico', () => {
    expect(redisRetryDelay(3)).toBe(redisRetryDelay(3));
  });
});
