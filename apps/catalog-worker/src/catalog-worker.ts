/**
 * CatalogWorker — Dono de buscar dado FRESCO e gravar o catálogo.
 *
 * Especificação: docs/plans/historico-precos.md §3.2 e §8
 *
 * Para cada CatalogJob (Queue C):
 *   1. Busca dado do produto (ML: GET items/{id} público; Shopee:
 *      getProductOffer com creds do userId; outros: sem fetch)
 *   2. Upsert products (ON CONFLICT product_key)
 *   3. Resolve variações (ML real; outros variação única :default)
 *   4. Upsert product_variations (ON CONFLICT variation_key)
 *   5. Append price_history com priceBucket = dateTruncHour(capturedAt)
 *      (ON CONFLICT DO NOTHING — dedup 1h sem duplicação)
 *   6. ACK na Queue C; falha → DLQ (pushToDLQ), nunca trava a fila.
 *
 * A lógica de transformação vive em catalog-pure (packages/db) e o I/O
 * de rede em catalog-fetcher. Este arquivo orquestra + métricas.
 */
import type { CatalogJob } from '@omestre/shared';
import { makeLogger } from '@omestre/shared';
import {
  CatalogRepository,
  UserCredentialsRepository,
  buildMlVariations,
  buildProductUpsertFromMl,
  buildProductUpsertFromShopee,
  buildSingleVariationFromShopee,
  ensureCatalogFetchResult,
} from '@omestre/db';
import {
  StepTracker,
  registerStepTrackers,
  createCounter,
  incrementCounter,
} from '@omestre/worker-common';
import { fetchCatalogData } from './catalog-fetcher.ts';

const log = makeLogger('catalog-worker');

// ─── Métricas ────────────────────────────────────────────────────────

export const steps = {
  fetch: new StepTracker(),
  persist: new StepTracker(),
  total: new StepTracker(),
};

export function initMetrics(): void {
  registerStepTrackers(steps);
  createCounter('catalog_jobs_received_total', 'CatalogJobs recebidos da Queue C');
  createCounter('catalog_jobs_processed_total', 'CatalogJobs processados com sucesso', [
    'marketplace',
  ]);
  createCounter('catalog_jobs_skipped_total', 'CatalogJobs sem dado útil (sem price)', ['reason']);
  createCounter('catalog_jobs_failed_total', 'CatalogJobs que foram para a DLQ', ['marketplace']);
  createCounter('catalog_variations_written_total', 'Variações upsertadas', ['marketplace']);
  createCounter('catalog_price_points_inserted_total', 'Pontos de preço inseridos', [
    'marketplace',
  ]);
}

// ─── Processamento ───────────────────────────────────────────────────

export interface ProcessCatalogJobDeps {
  repo: CatalogRepository;
  credentialsRepo: UserCredentialsRepository | null;
}

/**
 * Processa um CatalogJob: busca dado fresco, grava catálogo.
 *
 * Retorna:
 *   - true  → processado com sucesso (ACK)
 *   - false → sem dado útil (produto não encontrado / sem preço) —
 *             ainda assim ACK (não é erro permanente; re-envio pode
 *             eventualmente ter dado). Descartar é a política: a DLQ
 *             é para falhas REAIS, não para produtos sem oferta ativa.
 *
 * Lança em erro de infra (DB/Redis) — o caller decide ACK vs DLQ.
 */
export async function processCatalogJob(
  job: CatalogJob,
  deps: ProcessCatalogJobDeps,
): Promise<boolean> {
  incrementCounter('catalog_jobs_received_total');

  const t0 = performance.now();
  let marketplace = job.marketplace;

  try {
    // ── 1. Busca dado fresco ──
    let fetchResult;
    const fetchStart = performance.now();
    try {
      fetchResult = await fetchCatalogData({ job, credentialsRepo: deps.credentialsRepo });
    } finally {
      steps.fetch.observe(performance.now() - fetchStart);
    }

    // ── 2. Monta payloads de upsert (lógica pura) ──
    const capturedAt = new Date(job.capturedAt);
    let productRow;
    let variations;

    if (fetchResult.kind === 'ml') {
      productRow = buildProductUpsertFromMl(job, fetchResult.item);
      variations = buildMlVariations(
        job.productKey,
        fetchResult.item,
        capturedAt,
        job.sourceGroupJid,
        job.messageId,
      );
    } else if (fetchResult.kind === 'shopee') {
      productRow = buildProductUpsertFromShopee(job, fetchResult.offer);
      const single = buildSingleVariationFromShopee(
        job.productKey,
        fetchResult.offer,
        capturedAt,
        job.sourceGroupJid,
        job.messageId,
      );
      variations = single ? [single] : [];
    } else {
      // Sem dado (fetch falhou, sem creds, marketplace não suportado)
      incrementCounter('catalog_jobs_skipped_total', { reason: fetchResult.reason });
      log('warn', 'CatalogJob sem dado fresco — descartado (ACK)', {
        productKey: job.productKey,
        reason: fetchResult.reason,
      });
      return true;
    }

    const result = ensureCatalogFetchResult(productRow, variations);
    if (result === null) {
      incrementCounter('catalog_jobs_skipped_total', { reason: 'no_price' });
      log('warn', 'CatalogJob sem preço utilizável — descartado (ACK)', {
        productKey: job.productKey,
      });
      return true;
    }

    // ── 3. Persiste (upsert product → variations → price_history) ──
    const persistStart = performance.now();
    let written;
    try {
      written = await deps.repo.upsertCatalog(result);
    } finally {
      steps.persist.observe(performance.now() - persistStart);
    }

    incrementCounter('catalog_jobs_processed_total', { marketplace });
    for (let i = 0; i < written.variationIds.length; i++) {
      incrementCounter('catalog_variations_written_total', { marketplace });
    }
    for (let i = 0; i < written.insertedHistory; i++) {
      incrementCounter('catalog_price_points_inserted_total', { marketplace });
    }

    steps.total.observe(performance.now() - t0);
    log('info', 'CatalogJob processado', {
      productKey: job.productKey,
      productId: written.productId,
      variations: written.variationIds.length,
      pricePointsInserted: written.insertedHistory,
    });
    return true;
  } catch (err) {
    steps.total.observe(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    log('error', 'Erro ao processar CatalogJob', {
      productKey: job.productKey,
      error: msg,
    });
    incrementCounter('catalog_jobs_failed_total', { marketplace });
    throw err;
  }
}
