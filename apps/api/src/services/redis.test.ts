/**
 * Testes do singleton Redis em apps/api.
 *
 * Cobre:
 *  - config.REDIS_URL: default + override via env (com resetConfig)
 *  - getRedis: comportamento lazy baseado no estado global
 *
 * Não conectamos a um Redis real. O módulo usa ioredis diretamente
 * e seu construtor só roda quando getRedis() é chamado e o client
 * ainda não existe — testamos só o caminho do env + config.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { config } from '../config.ts';

describe('config.REDIS_URL', () => {
  let originalRedisUrl: string | undefined;

  beforeEach(() => {
    originalRedisUrl = process.env.REDIS_URL;
    config.reset();
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = originalRedisUrl;
    }
    config.reset();
  });

  it('default é redis://localhost:5455', () => {
    delete process.env.REDIS_URL;
    config.reset();
    expect(config.REDIS_URL).toBe('redis://localhost:5455');
  });

  it('lê env override', () => {
    process.env.REDIS_URL = 'redis://custom:1234';
    config.reset();
    expect(config.REDIS_URL).toBe('redis://custom:1234');
  });
});
