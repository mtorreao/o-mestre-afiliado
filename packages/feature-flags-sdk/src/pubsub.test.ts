/**
 * Testes do PubSub do SDK. Usa ioredis-mock para isolar o comportamento de
 * publish/subscribe sem precisar de Redis real.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import RedisMock from 'ioredis-mock';
import { __resetFlagRedisForTesting, __setRedisFactoryForTesting } from './redis.ts';
import { FLAG_INVALIDATE_CHANNEL, buildFlagStatsKey } from './keys.ts';
import { publishFlagInvalidation, subscribeFlagInvalidation } from './pubsub.ts';

describe('publishFlagInvalidation', () => {
  afterEach(async () => {
    __resetFlagRedisForTesting();
  });

  it('publica no canal correto', async () => {
    const mock = new RedisMock();
    // Captura todas as mensagens publicadas no canal
    const pubsubMock = new RedisMock();
    const received: string[] = [];
    await pubsubMock.subscribe(FLAG_INVALIDATE_CHANNEL);
    pubsubMock.on('message', (_channel, message) => received.push(message));

    // O factory cria o publisher; o subscriber já existe independentemente
    __setRedisFactoryForTesting(() => mock as never);
    const ok = publishFlagInvalidation('maintenance_mode', 'redis://x:6379');
    expect(ok).toBe(true);

    // Aguarda o publish assíncrono propagar
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain('maintenance_mode');
    await pubsubMock.quit();
    await mock.quit();
  });

  it('retorna false se Redis indisponível', () => {
    const prev = process.env.REDIS_URL;
    try {
      delete process.env.REDIS_URL;
      const ok = publishFlagInvalidation('evolution_send_enabled');
      expect(ok).toBe(false);
    } finally {
      if (prev !== undefined) process.env.REDIS_URL = prev;
    }
  });
});

describe('subscribeFlagInvalidation', () => {
  afterEach(async () => {
    __resetFlagRedisForTesting();
  });

  it('retorna função unsubscribe e callback é invocado', async () => {
    const mock = new RedisMock();
    __setRedisFactoryForTesting(() => mock as never);

    const received: string[] = [];
    const unsub = await subscribeFlagInvalidation((k) => received.push(k), 'redis://x:6379');
    expect(unsub).not.toBeNull();
    if (!unsub) return;

    // Publica via raw mock
    await mock.publish(FLAG_INVALIDATE_CHANNEL, 'maintenance_mode');
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toContain('maintenance_mode');
    await unsub();
    await mock.quit();
  });

  it('callback ignora mensagens de canal diferente', async () => {
    const mock = new RedisMock();
    __setRedisFactoryForTesting(() => mock as never);

    const received: string[] = [];
    const unsub = await subscribeFlagInvalidation((k) => received.push(k), 'redis://x:6379');
    if (!unsub) {
      await mock.quit();
      return;
    }

    await mock.publish('outro:canal', 'mensagem');
    await mock.publish(FLAG_INVALIDATE_CHANNEL, 'maintenance_mode');
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual(['maintenance_mode']);
    await unsub();
    await mock.quit();
  });

  it('retorna null se Redis indisponível', async () => {
    const prev = process.env.REDIS_URL;
    try {
      delete process.env.REDIS_URL;
      const unsub = await subscribeFlagInvalidation(() => {});
      expect(unsub).toBeNull();
    } finally {
      if (prev !== undefined) process.env.REDIS_URL = prev;
    }
  });
});

// sanity check pra garantir que buildFlagStatsKey continua reexportado
describe('re-export sanity', () => {
  it('buildFlagStatsKey existe', () => {
    expect(typeof buildFlagStatsKey).toBe('function');
  });
});
