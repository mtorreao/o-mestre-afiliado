/**
 * catalog-publisher — Publica CatalogJobs na Queue C (omestre:mirror:catalog).
 *
 * O Ingestor SÓ PUBLICA a identidade do produto (XADD O(1), fire-and-forget);
 * quem busca o dado fresco (preço/variação/imagem) e grava no catálogo é o
 * CatalogWorker (apps/catalog-worker). Falha na publicação NUNCA quebra o
 * espelhamento — o caller é responsável por capturar o erro e logar warn.
 *
 * Também usado pelo backfill (apps/catalog-worker/src/backfill.ts) para
 * popular a Queue C a partir do histórico de reflected_offers.
 *
 * A resolução de identidade (`resolveCatalogTarget`) é PURA (parse de URL,
 * sem rede) e vive em @omestre/shared para ser reutilizada sem duplicação.
 */
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { CatalogJob } from '@omestre/shared';
import { MIRROR_CATALOG_STREAM, resolveCatalogTarget } from '@omestre/shared';

/** Cap de memória da Queue C (XADD MAXLEN ~) — ~50k jobs */
export const CATALOG_STREAM_MAXLEN = 50_000;

export interface PublishCatalogJobParams {
  /** Marketplace detectado na mensagem */
  marketplace: string;
  /** URL já resolvida (redirect tratado) — base para o worker buscar dado fresco */
  resolvedUrl: string;
  /** JID do grupo de origem */
  sourceGroupJid: string;
  /** messageId original da mensagem (ou `backfill:<rowId>` para backfill) */
  messageId: string;
  /** userId de plataforma do afiliado — null se não parseável */
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
