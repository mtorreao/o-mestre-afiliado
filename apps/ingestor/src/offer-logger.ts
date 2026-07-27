/**
 * logReflectedOffer — Registra o envio (ou falha) de uma oferta espelhada
 * na tabela `reflected_offers`. Falha de DB não bloqueia o pipeline.
 *
 * A montagem do objeto a ser persistido é uma função PURA
 * (`buildReflectedOfferRow`) — fácil de testar isoladamente sem precisar
 * de DB/Redis. A camada de I/O (insert no Postgres) vive em `logReflectedOffer`.
 */
import { getDb, reflectedOffers } from '@omestre/db';
import { makeLogger } from '@omestre/shared';

const log = makeLogger('ingestor');

/** Union aceito pela coluna `marketplace` do schema (DB). */
type MarketplaceDb = 'shopee' | 'mercadolivre' | 'amazon' | 'magalu' | 'unknown';

export interface ReflectedOfferInput {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink?: string | null;
  marketplace: string;
  messagePreview: string;
  status: 'sent' | 'failed' | 'blocked';
  failureReason?: string;
}

/**
 * Monta o objeto persistido na tabela `reflected_offers`.
 *
 * Regras (puras):
 *  - `convertedLink` cai para `originalLink` quando null/undefined.
 *  - `messagePreview` é truncado em 500 chars.
 *  - `marketplace` é normalizado para o union type do schema.
 *  - `failureReason` cai para null quando ausente/undefined.
 *
 * Não faz nenhuma I/O — apenas transforma os parâmetros em linha.
 */
export function buildReflectedOfferRow(
  params: ReflectedOfferInput,
): {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string;
  marketplace: MarketplaceDb;
  messagePreview: string;
  status: 'sent' | 'failed' | 'blocked';
  failureReason: string | null;
} {
  return {
    affiliateId: params.affiliateId,
    sourceGroupJid: params.sourceGroupJid,
    targetGroupJid: params.targetGroupJid,
    originalLink: params.originalLink,
    convertedLink: params.convertedLink ?? params.originalLink,
    marketplace: params.marketplace as MarketplaceDb,
    messagePreview: params.messagePreview.slice(0, 500),
    status: params.status,
    failureReason: params.failureReason ?? null,
  };
}

export async function logReflectedOffer(params: ReflectedOfferInput): Promise<void> {
  try {
    const db = getDb();
    await db.insert(reflectedOffers).values(buildReflectedOfferRow(params));
  } catch (err) {
    log('error', 'Erro ao registrar reflected_offer', {
      error: String(err),
      ...params,
    });
  }
}
