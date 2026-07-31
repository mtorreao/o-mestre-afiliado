/**
 * catalog-pure — Helpers puros para o CatalogWorker.
 *
 * Especificação: docs/plans/historico-precos.md §3.2
 *
 * Toda lógica de transformação / mapeamento / parsing vive aqui para
 * ser testável sem rede e sem banco. O repositório e o worker importam
 * estas funções.
 */
import type { CatalogJob } from '@omestre/shared';

// ─── Tipos públicos ──────────────────────────────────────────────────

/** Linhas que vão para upsert em products. */
export interface ProductUpsertRow {
  marketplace: 'shopee' | 'mercadolivre' | 'amazon' | 'magalu' | 'unknown';
  itemId: string;
  productKey: string;
  title: string | null;
  imageUrl: string | null;
}

/** Linhas que vão para upsert em product_variations. */
export interface VariationUpsertRow {
  variationKey: string;
  variationId: string | null;
  variationName: string | null;
  attributesJson: Record<string, unknown>;
}

/** Linhas que vão para append em price_history. */
export interface PriceHistoryRow {
  variationId: number;
  price: string;
  listPrice: string | null;
  currency: string;
  available: boolean;
  stock: number | null;
  priceBucket: Date;
  capturedAt: Date;
  source: 'background' | 'manual' | 'api' | 'backfill';
  sourceGroupJid: string | null;
  messageId: string | null;
}

/** Par variação + linha de histórico, gerado pelo fetcher. */
export interface VariationWithPrice {
  row: VariationUpsertRow;
  price: Omit<PriceHistoryRow, 'variationId'>;
}

/** Saída agregada de uma busca + montagem (1 produto, N variações). */
export interface CatalogFetchResult {
  product: ProductUpsertRow;
  variations: VariationWithPrice[];
}

// ─── dateTruncHour ──────────────────────────────────────────────────

/**
 * Trunca uma data para o início da hora UTC.
 *
 * Equivalente a date_trunc('hour', ts) no PostgreSQL — alinhado ao
 * índice único price_history_dedup_idx para deduplicação de 1h.
 *
 * Função PURA.
 */
export function dateTruncHour(input: Date | string): Date {
  const d = typeof input === 'string' ? new Date(input) : new Date(input.getTime());
  if (Number.isNaN(d.getTime())) {
    throw new Error('dateTruncHour: data inválida');
  }
  d.setUTCMinutes(0, 0, 0);
  return d;
}

// ─── Price normalization ────────────────────────────────────────────

/**
 * Converte qualquer representação de preço para string no formato
 * numeric(12,2) aceito pelo driver postgres do Drizzle.
 *
 * Aceita: number (ex: 199.9), string numérica (ex: "199.90"),
 * string com vírgula (ex: "199,90"), null/undefined (→ null).
 *
 * Função PURA.
 */
export function normalizePrice(input: number | string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const n = typeof input === 'string' ? Number(input.replace(',', '.')) : input;
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

// ─── Variação única implícita :default ─────────────────────────────

/**
 * Sufixo da variação única para marketplaces sem variações reais
 * (Shopee, Amazon, etc.). Documentado na spec §3.2.
 */
export const DEFAULT_VARIATION_SUFFIX = 'default';

/**
 * Monta a variation_key canônica: productKey:suffix.
 * Função PURA.
 */
export function buildVariationKey(productKey: string, variationId: string | null): string {
  return productKey + ':' + (variationId ?? DEFAULT_VARIATION_SUFFIX);
}

// ─── Mercado Livre: variações + produto ─────────────────────────────

/** Resposta crua mínima da API pública do ML (apenas campos usados). */
export interface MlFetchedItem {
  id?: string;
  title?: string;
  pictures?: Array<{ url?: string; secure_url?: string }>;
  variations?: Array<{
    id?: string | number;
    price?: number | string | null;
    original_price?: number | string | null;
    available_quantity?: number;
    attribute_combinations?: Array<{ name?: string; value_name?: string }>;
  }>;
  price?: number | string | null;
  original_price?: number | string | null;
  available_quantity?: number;
}

/** Constrói ProductUpsertRow a partir de uma resposta ML. Função PURA. */
export function buildProductUpsertFromMl(job: CatalogJob, item: MlFetchedItem): ProductUpsertRow {
  const firstPic = item.pictures?.[0];
  const imageUrl = firstPic?.secure_url ?? firstPic?.url ?? null;
  return {
    marketplace: 'mercadolivre',
    itemId: job.itemId,
    productKey: job.productKey,
    title: item.title?.trim() || null,
    imageUrl,
  };
}

/**
 * Constrói a lista de variações ML a partir da resposta.
 *
 * - Quando variations[] tem itens, cada um vira uma VariationWithPrice.
 * - Quando variations[] está vazio/ausente, gera UMA variação
 *   implícita productKey:default usando price/original_price/
 *   available_quantity do item raiz.
 *
 * Função PURA.
 */
export function buildMlVariations(
  productKey: string,
  item: MlFetchedItem,
  capturedAt: Date,
  sourceGroupJid: string | null,
  messageId: string | null,
): VariationWithPrice[] {
  const priceBucket = dateTruncHour(capturedAt);
  const source: PriceHistoryRow['source'] = 'background';

  if (Array.isArray(item.variations) && item.variations.length > 0) {
    const variations: VariationWithPrice[] = [];
    for (const v of item.variations) {
      const price = normalizePrice(v.price);
      if (price === null) continue; // variação sem price não invalida o job — apenas é pulada

      const vId = v.id != null ? String(v.id) : null;
      const variationKey = buildVariationKey(productKey, vId);

      const attrs: Record<string, unknown> = {};
      const combos = Array.isArray(v.attribute_combinations) ? v.attribute_combinations : [];
      for (const c of combos) {
        if (c.name && c.value_name != null) attrs[c.name] = c.value_name;
      }

      const stockNum = typeof v.available_quantity === 'number' ? v.available_quantity : null;
      const available = stockNum == null ? true : stockNum > 0;

      const variationName =
        Object.values(attrs)
          .filter((x) => typeof x === 'string' && x.length > 0)
          .join(' / ') || null;

      variations.push({
        row: {
          variationKey,
          variationId: vId,
          variationName,
          attributesJson: attrs,
        },
        price: {
          price,
          listPrice: normalizePrice(v.original_price),
          currency: 'BRL',
          available,
          stock: stockNum,
          priceBucket,
          capturedAt,
          source,
          sourceGroupJid,
          messageId,
        },
      });
    }
    return variations;
  }

  const price = normalizePrice(item.price);
  if (price === null) return [];

  const stockNum = typeof item.available_quantity === 'number' ? item.available_quantity : null;
  const available = stockNum == null ? true : stockNum > 0;

  return [
    {
      row: {
        variationKey: buildVariationKey(productKey, null),
        variationId: null,
        variationName: null,
        attributesJson: {},
      },
      price: {
        price,
        listPrice: normalizePrice(item.original_price),
        currency: 'BRL',
        available,
        stock: stockNum,
        priceBucket,
        capturedAt,
        source,
        sourceGroupJid,
        messageId,
      },
    },
  ];
}

// ─── Shopee: produto + variação única implícita ─────────────────────

/** Resposta crua mínima do getProductOffer (Shopee GraphQL). */
export interface ShopeeFetchedOffer {
  itemId?: number | string;
  shopId?: number | string;
  productName?: string;
  imageUrl?: string;
  price?: number | string;
  priceMin?: number | string;
  priceMax?: number | string;
}

/** Constrói ProductUpsertRow a partir de uma oferta Shopee. Função PURA. */
export function buildProductUpsertFromShopee(
  job: CatalogJob,
  offer: ShopeeFetchedOffer,
): ProductUpsertRow {
  return {
    marketplace: 'shopee',
    itemId: job.itemId,
    productKey: job.productKey,
    title: offer.productName?.trim() || null,
    imageUrl: offer.imageUrl ?? null,
  };
}

/**
 * Constrói a variação única implícita para Shopee.
 *
 * - price preferido; se ausente, cai pra priceMin; por fim priceMax.
 * - Shopee não tem original_price/available_quantity confiáveis no
 *   productOfferV2, então listPrice/stock ficam null e available=true.
 *
 * Retorna null quando não há preço algum.
 *
 * Função PURA.
 */
export function buildSingleVariationFromShopee(
  productKey: string,
  offer: ShopeeFetchedOffer,
  capturedAt: Date,
  sourceGroupJid: string | null,
  messageId: string | null,
): VariationWithPrice | null {
  const price = normalizePrice(offer.price ?? offer.priceMin ?? offer.priceMax);
  if (price === null) return null;

  return {
    row: {
      variationKey: buildVariationKey(productKey, null),
      variationId: null,
      variationName: null,
      attributesJson: {},
    },
    price: {
      price,
      listPrice: null,
      currency: 'BRL',
      available: true,
      stock: null,
      priceBucket: dateTruncHour(capturedAt),
      capturedAt,
      source: 'background',
      sourceGroupJid,
      messageId,
    },
  };
}

/**
 * Garante um CatalogFetchResult completo (pelo menos 1 variação com
 * preço). Retorna null quando não há nada útil para gravar.
 *
 * Função PURA.
 */
export function ensureCatalogFetchResult(
  product: ProductUpsertRow,
  variations: VariationWithPrice[],
): CatalogFetchResult | null {
  if (variations.length === 0) return null;
  return { product, variations };
}
