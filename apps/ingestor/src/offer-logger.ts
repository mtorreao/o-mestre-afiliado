/**
 * logReflectedOffer — Registra o envio (ou falha) de uma oferta espelhada
 * na tabela `reflected_offers`. Falha de DB não bloqueia o pipeline.
 */
import { getDb, reflectedOffers } from '@omestre/db';
import { makeLogger } from '@omestre/shared';

const log = makeLogger('ingestor');

export async function logReflectedOffer(params: {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string | null;
  marketplace: string;
  messagePreview: string;
  status: 'sent' | 'failed' | 'blocked';
  failureReason?: string;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(reflectedOffers).values({
      affiliateId: params.affiliateId,
      sourceGroupJid: params.sourceGroupJid,
      targetGroupJid: params.targetGroupJid,
      originalLink: params.originalLink,
      convertedLink: params.convertedLink ?? params.originalLink,
      marketplace: params.marketplace as 'shopee' | 'mercadolivre' | 'amazon' | 'unknown',
      messagePreview: params.messagePreview.slice(0, 500),
      status: params.status,
      failureReason: params.failureReason ?? null,
    });
  } catch (err) {
    log('error', 'Erro ao registrar reflected_offer', {
      error: String(err),
      ...params,
    });
  }
}
