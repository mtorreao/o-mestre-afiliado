/**
 * payload-helpers.ts — geradores puros de payloads nao-cobertos pelo
 * webhook-payload-pure.ts.
 *
 * Cobrimos:
 *   - Eventos secundarios do webhook (connection.update, qrcode.updated,
 *     groups.upsert, group-participants.update) — o hot path so trata
 *     messages.upsert; os outros retornam 200 rapido, mas sao caminho real.
 *   - Auth: register, login, refresh. Mesmos shapes que auth.routes.ts.
 *   - Affiliate CRUD: GET/PUT profile, GET mirror-logs.
 *   - Catalog GETs (pagina publica do catalogo de produtos espelhados).
 *   - Healthcheck (sem auth).
 *
 * Determinismo: mulberry32 (re-exportado) garante reprodutibilidade
 * entre rodadas — util para regressao comparativa (compare A/B).
 */
import { mulberry32 } from './webhook-payload-pure.ts';

export interface AuthRegisterPayload {
  email: string;
  name: string;
  password: string;
}

export interface AuthLoginPayload {
  email: string;
  password: string;
}

export interface AuthRefreshPayload {
  refreshToken: string;
}

/** Gera email deterministicamente para isolamento entre users. */
export function makeEmail(userId: number): string {
  return `loadtest-u${userId}@omestre.local`;
}

/** Senha forte (>=8 chars com mix). */
export function makePassword(seed: number): string {
  const rand = mulberry32(seed);
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%&*';
  const pick = (chars: string) => chars[Math.floor(rand() * chars.length)] ?? 'a';
  return (
    pick(upper) +
    pick(lower) +
    pick(lower) +
    pick(lower) +
    pick(digits) +
    pick(digits) +
    pick(special)
  );
}

/** Body de POST /api/auth/register (mesmo shape que auth.routes.ts). */
export function buildAuthRegister(userId: number, seed: number): AuthRegisterPayload {
  return {
    email: makeEmail(userId),
    name: `Load Test User ${userId}`,
    password: makePassword(seed),
  };
}

/** Body de POST /api/auth/login. */
export function buildAuthLogin(userId: number, seed: number): AuthLoginPayload {
  return {
    email: makeEmail(userId),
    password: makePassword(seed),
  };
}

/** Body de POST /api/auth/refresh. */
export function buildAuthRefresh(refreshToken: string): AuthRefreshPayload {
  return { refreshToken };
}

export type WebhookSecondaryEvent =
  'connection.update' | 'qrcode.updated' | 'groups.upsert' | 'group-participants.update';

/** Eventos secundarios do webhook (handler retorna 200 rapido). */
export function buildSecondaryWebhookEvent(
  eventName: WebhookSecondaryEvent,
  instanceName: string,
  seed: number,
): { event: string; instance: string; data: unknown } {
  const rand = mulberry32(seed);
  switch (eventName) {
    case 'connection.update':
      return {
        event: eventName,
        instance: instanceName,
        data: {
          state: rand() > 0.5 ? 'open' : 'connecting',
          statusReason: 200,
        },
      };
    case 'qrcode.updated':
      return {
        event: eventName,
        instance: instanceName,
        data: {
          qrcode: { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA=', code: 'LOAD-QR-' + seed },
        },
      };
    case 'groups.upsert':
      return {
        event: eventName,
        instance: instanceName,
        data: { id: `12036300000000000${(seed % 5).toString()}@g.us`, subject: 'Group ' + seed },
      };
    case 'group-participants.update':
      return {
        event: eventName,
        instance: instanceName,
        data: {
          groupId: `12036300000000000${(seed % 5).toString()}@g.us`,
          participants: ['55119' + (seed % 10) + '@s.whatsapp.net'],
          action: 'add',
        },
      };
  }
}

/** Body de PUT /api/affiliate/profile (parcial — messageTemplate/affiliateStatus). */
export function buildAffiliateProfileUpdate(seed: number): Record<string, unknown> {
  const rand = mulberry32(seed);
  return {
    affiliateStatus: rand() > 0.5 ? 'active' : 'paused',
    messageTemplate: '🛒 {marketplace_nome}\n{link_convertido}\n\n📅 {data_hora}',
  };
}

/** Body de POST /api/affiliate/test-conversion. */
export function buildTestConversionPayload(
  marketplace: 'shopee' | 'mercadolivre' | 'amazon' | 'magalu',
): Record<string, unknown> {
  const samples: Record<string, string> = {
    shopee: 'https://shopee.com.br/Capinha-i.1006874942.23694247133',
    mercadolivre: 'https://www.mercadolivre.com.br/p/MLB1234567890',
    amazon: 'https://www.amazon.com.br/dp/B07PXGQCK5',
    magalu: 'https://www.magazineluiza.com.br/celular/p/abc123/',
  };
  return { url: samples[marketplace] };
}

/** Body malformado de webhook (para testar rejeicao graciosa). */
export function buildMalformedWebhook(seed: number): {
  event: string;
  instance: string;
  data: unknown;
} {
  return {
    event: 'messages.upsert',
    instance: 'user-malformed',
    // data propositalmente quebra: nao tem `key.remoteJid` (extrator exige)
    data: { key: { id: 'BAD' + seed }, message: { conversation: 'x' } },
  };
}

/** Webhook com remoteJid que nao esta em source-groups (cache negativo). */
export function buildIgnoredWebhook(seed: number): {
  event: string;
  instance: string;
  data: unknown;
} {
  return {
    event: 'messages.upsert',
    instance: 'user-1',
    data: {
      key: {
        id: 'IGN' + seed,
        // JID que deliberadamente NAO e source-group de nenhum afiliado
        remoteJid: '120999999999999999@g.us',
        fromMe: false,
      },
      message: { conversation: 'oferta para grupo nao monitorado' },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
}
