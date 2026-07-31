/**
 * catalog-publisher — Publica CatalogJobs na Queue C (omestre:mirror:catalog).
 *
 * O Ingestor SÓ PUBLICA a identidade do produto (XADD O(1), fire-and-forget);
 * quem busca o dado fresco (preço/variação/imagem) e grava no catálogo é o
 * CatalogWorker (apps/catalog-worker, futuro). Falha na publicação NUNCA
 * quebra o espelhamento — o caller é responsável por capturar o erro e
 * logar warn.
 *
 * A resolução de identidade (`resolveCatalogTarget`) é PURA (parse de URL,
 * sem rede) e vive aqui para ser testável isoladamente.
 */
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { CatalogJob } from '@omestre/shared';
import { MIRROR_CATALOG_STREAM } from '@omestre/shared';
import { extractShopeeItemIdFromUrl } from '@omestre/converters';

/** Cap de memória da Queue C (XADD MAXLEN ~) — ~50k jobs */
export const CATALOG_STREAM_MAXLEN = 50_000;

/** ItemId do Mercado Livre: prefixo de país + 8+ dígitos (MLB/MLM/MLA/MCO/MLC) */
const ML_ITEM_ID_RE = /(MLB|MLM|MLA|MCO|MLC)\d{8,}/i;

/** ASIN da Amazon: /dp/ASIN */
const AMAZON_ASIN_RE = /\/dp\/([A-Z0-9]{10})/i;

/** Identidade de produto resolvida por parse (sem rede). */
export interface CatalogTarget {
  marketplace: string;
  itemId: string;
  productKey: string;
}

/**
 * Resolve `marketplace:itemId` por parse da URL resolvida (sem rede).
 * Retorna null quando o item não é normalizável (marketplace sem parser
 * ou ID ausente) — nesse caso NÃO se publica na Queue C.
 */
export function resolveCatalogTarget(
  marketplace: string,
  resolvedUrl: string,
): CatalogTarget | null {
  switch (marketplace) {
    case 'shopee': {
      const itemId = extractShopeeItemIdFromUrl(resolvedUrl);
      if (itemId === null) return null;
      return { marketplace, itemId: String(itemId), productKey: `shopee:${itemId}` };
    }
    case 'mercadolivre': {
      const match = resolvedUrl.match(ML_ITEM_ID_RE);
      const itemId = match?.[0]?.toUpperCase();
      if (!itemId) return null;
      return { marketplace, itemId, productKey: `mercadolivre:${itemId}` };
    }
    case 'amazon': {
      const match = resolvedUrl.match(AMAZON_ASIN_RE);
      const itemId = match?.[1]?.toUpperCase();
      if (!itemId) return null;
      return { marketplace, itemId, productKey: `amazon:${itemId}` };
    }
    default:
      // magalu/unknown/outros: sem parser de itemId — não publica
      return null;
  }
}

export interface PublishCatalogJobParams {
  /** Marketplace detectado na mensagem */
  marketplace: string;
  /** URL já resolvida (redirect tratado) */
  resolvedUrl: string;
  /** JID do grupo de origem */
  sourceGroupJid: string;
  /** messageId original da mensagem */
  messageId: string;
  /** userId de plataforma do afiliado (do SourceGroupConfig) — null se não parseável */
  userId?: number | null;
  /** ID injetável (default randomUUID) — p/ testes determinísticos */
  id?: string;
  /** Timestamp injetável (default now) — p/ testes determinísticos */
  capturedAt?: string;
}

/**
 * Publica um CatalogJob na Queue C (XADD O(1), fire-and-forget).
 *
 * Retorna true quando publicou; false quando o itemId não é resolvível
 * ou o Redis está indisponível (não publica). Lança em falha de Redis —
 * o caller decide o log (o espelhamento NUNCA pode quebrar por isso).
 */
export async function publishCatalogJob(
  params: PublishCatalogJobParams,
  redis: Redis | null,
): Promise<boolean> {
  const target = resolveCatalogTarget(params.marketplace, params.resolvedUrl);
  if (!target || !redis) return false;

  const job: CatalogJob = {
    id: params.id ?? randomUUID(),
    productKey: target.productKey,
    marketplace: target.marketplace,
    itemId: target.itemId,
    resolvedUrl: params.resolvedUrl,
    sourceGroupJid: params.sourceGroupJid,
    messageId: params.messageId,
    capturedAt: params.capturedAt ?? new Date().toISOString(),
    userId: params.userId ?? null,
  };

  await redis.xadd(
    MIRROR_CATALOG_STREAM,
    'MAXLEN',
    '~',
    CATALOG_STREAM_MAXLEN,
    '*',
    'payload',
    JSON.stringify(job),
  );
  return true;
}
