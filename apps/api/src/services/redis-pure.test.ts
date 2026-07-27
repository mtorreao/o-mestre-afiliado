/**
 * Testes das funções PURAS do wrapper Redis (redis-pure.ts).
 *
 * Serialização, deserialização, args de stream e retry strategy —
 * sem nenhuma conexão Redis real.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildStreamAddArgs,
  computeRetryDelay,
  deserializeCacheValue,
  serializeCacheValue,
} from './redis-pure.ts';

describe('serializeCacheValue', () => {
  it('serializa objeto como JSON', () => {
    expect(serializeCacheValue({ a: 1 })).toBe('{"a":1}');
  });

  it('serializa array', () => {
    expect(serializeCacheValue([1, 2])).toBe('[1,2]');
  });

  it('serializa null', () => {
    expect(serializeCacheValue(null)).toBe('null');
  });
});

describe('deserializeCacheValue', () => {
  it('faz round-trip com serializeCacheValue', () => {
    const value = { groups: [{ jid: '1@g.us', name: 'A' }] };
    expect(deserializeCacheValue<typeof value>(serializeCacheValue(value))).toEqual(value);
  });

  it('null → null', () => {
    expect(deserializeCacheValue(null)).toBeNull();
  });

  it('string vazia → null', () => {
    expect(deserializeCacheValue('')).toBeNull();
  });

  it('JSON inválido → null (não lança)', () => {
    expect(deserializeCacheValue('{oops')).toBeNull();
  });

  it('preserva tipos primitivos', () => {
    expect(deserializeCacheValue<number>('42')).toBe(42);
    expect(deserializeCacheValue<boolean>('true')).toBe(true);
  });
});

describe('buildStreamAddArgs', () => {
  it('monta [stream, "*", "payload", json]', () => {
    const args = buildStreamAddArgs('omestre:mirror:raw', { messageId: 'm1' });
    expect(args).toEqual(['omestre:mirror:raw', '*', 'payload', '{"messageId":"m1"}']);
  });

  it('payload é JSON parseável de volta', () => {
    const event = { messageId: 'm1', groupJid: '1@g.us', text: 'oferta' };
    const args = buildStreamAddArgs('s', event);
    expect(JSON.parse(args[3])).toEqual(event);
  });
});

describe('computeRetryDelay', () => {
  it('backoff linear: 200ms na 1ª tentativa', () => {
    expect(computeRetryDelay(1)).toBe(200);
  });

  it('400ms na 2ª, 600ms na 3ª', () => {
    expect(computeRetryDelay(2)).toBe(400);
    expect(computeRetryDelay(3)).toBe(600);
  });

  it('desiste (null) após 3 tentativas', () => {
    expect(computeRetryDelay(4)).toBeNull();
    expect(computeRetryDelay(100)).toBeNull();
  });

  it('cap em 1000ms nunca é excedido dentro do range válido', () => {
    for (let t = 1; t <= 3; t++) {
      expect(computeRetryDelay(t)!).toBeLessThanOrEqual(1000);
    }
  });
});
