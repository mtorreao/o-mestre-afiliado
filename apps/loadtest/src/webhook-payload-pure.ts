/**
 * webhook-payload-pure.ts — geração pura de payloads de webhook da
 * Evolution API v2 (messages.upsert) para o teste de carga.
 *
 * Sem I/O e deterministico (mulberry32) para reprodutibilidade. O formato
 * espelha EXATAMENTE o que apps/api/src/modules/webhook/webhook.routes.ts
 * consome em extractMessagesFromData(): data pode ser:
 *   - { messages: { records: [...] } }  (paginado)
 *   - { messages: [...] }               (array direto)
 *   - { key, message }                  (objeto único, v2.3.7+)
 */

export const MARKETPLACES = [
  'shopee.com.br',
  'mercadolivre.com.br',
  'magazinevoce.com.br',
  'amazon.com.br',
] as const;

/** PRNG deterministico mulberry32. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PayloadOptions {
  /** userId do dono da instancia (instanceName = user-{userId}). */
  userId: number;
  /** seed para PRNG deterministico. */
  seed?: number;
  /** formato do envelope data. */
  format?: 'paginated' | 'array' | 'single';
}

function buildMessage(rand: () => number, idx: number): Record<string, unknown> {
  const marketplace = MARKETPLACES[Math.floor(rand() * MARKETPLACES.length)]!;
  const productId = Math.floor(rand() * 1_000_000);
  const url = `https://${marketplace}/produto-${productId}`;
  const groupJid = `12036300000000000${idx % 5}@g.us`;
  const msgId = `LOAD${idx.toString(36).toUpperCase()}${Math.floor(rand() * 1e9).toString(36)}`;
  return {
    key: {
      id: msgId,
      remoteJid: groupJid,
      fromMe: false,
      participant: `55119${Math.floor(rand() * 1e6)}@s.whatsapp.net`,
    },
    message: {
      conversation: `Confira essa oferta: ${url}`,
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

/** Gera um unico evento webhook completo (envelope + data). */
export function buildWebhookEvent(opts: PayloadOptions): {
  event: string;
  instance: string;
  data: unknown;
} {
  const rand = mulberry32(opts.seed ?? opts.userId);
  const format = opts.format ?? 'paginated';
  const instance = `user-${opts.userId}`;
  const records = Array.from({ length: 3 }, (_, i) => buildMessage(rand, i));

  let data: unknown;
  if (format === 'paginated') {
    data = { messages: { records, total: records.length, pages: 1 } };
  } else if (format === 'array') {
    data = { messages: records };
  } else {
    data = records[0];
  }

  return { event: 'messages.upsert', instance, data };
}

/** Gera N eventos webhook para um lote. */
export function buildWebhookBatch(
  count: number,
  opts: PayloadOptions,
): Array<{ event: string; instance: string; data: unknown }> {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(buildWebhookEvent({ ...opts, seed: (opts.seed ?? 1) + i }));
  }
  return out;
}
