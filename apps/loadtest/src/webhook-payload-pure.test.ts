import { describe, it, expect } from 'bun:test';
import {
  buildWebhookBatch,
  buildWebhookEvent,
  MARKETPLACES,
  mulberry32,
} from './webhook-payload-pure.ts';

describe('mulberry32', () => {
  it('e deterministico para a mesma seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });
  it('retorna valor em [0,1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('buildWebhookEvent', () => {
  it('usa instanceName user-{userId}', () => {
    const e = buildWebhookEvent({ userId: 99, seed: 1 });
    expect(e.instance).toBe('user-99');
    expect(e.event).toBe('messages.upsert');
  });
  it('formato paginated envolve records', () => {
    const e = buildWebhookEvent({ userId: 1, seed: 2, format: 'paginated' });
    const data = e.data as { messages: { records: unknown[] } };
    expect(Array.isArray(data.messages.records)).toBe(true);
    expect(data.messages.records.length).toBe(3);
  });
  it('formato array expoe messages direto', () => {
    const e = buildWebhookEvent({ userId: 1, seed: 3, format: 'array' });
    const data = e.data as { messages: unknown[] };
    expect(Array.isArray(data.messages)).toBe(true);
  });
  it('formato single e objeto unico com key', () => {
    const e = buildWebhookEvent({ userId: 1, seed: 4, format: 'single' });
    const data = e.data as { key: { remoteJid: string } };
    expect(data.key.remoteJid).toBeDefined();
  });
  it('gera url de marketplace valida na mensagem', () => {
    const e = buildWebhookEvent({ userId: 1, seed: 5 });
    const data = e.data as { messages: { records: Array<{ message: { conversation: string } }> } };
    const conv = data.messages.records[0]!.message.conversation;
    expect(MARKETPLACES.some((m) => conv.includes(m))).toBe(true);
  });
});

describe('buildWebhookBatch', () => {
  it('gera count eventos', () => {
    const batch = buildWebhookBatch(10, { userId: 1, seed: 9 });
    expect(batch.length).toBe(10);
  });
  it('e deterministico com a mesma seed base', () => {
    const a = buildWebhookBatch(5, { userId: 3, seed: 11 });
    const b = buildWebhookBatch(5, { userId: 3, seed: 11 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
