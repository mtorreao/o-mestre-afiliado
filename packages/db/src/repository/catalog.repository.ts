/**
 * CatalogRepository — Operações de escrita E leitura no catálogo de produtos.
 *
 * Especificação: docs/plans/historico-precos.md §2.1-2.3, §3.2, §5.5.2
 *
 * Três tabelas:
 *   - products          → upsert por product_key (UNIQUE)
 *   - product_variations → upsert por variation_key (UNIQUE)
 *   - price_history     → append com ON CONFLICT DO NOTHING
 *                         (dedup 1h via índice único NULLS NOT DISTINCT)
 *
 * Escrita (populado exclusivamente pelo CatalogWorker via Queue C):
 *   upsertProduct / upsertVariation / appendPriceHistory / upsertCatalog
 *   — montagem de payloads em catalog-pure.ts (funções PURAS).
 *
 * Leitura (rotas admin /api/catalog/*, read-only):
 *   listProducts / getProductWithVariations / getVariationHistory
 *   — paginação em catalog-pagination.ts (funções PURAS).
 */
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { and, asc, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { products, productVariations, priceHistory } from '../schema/index.ts';
import type { marketplaceEnum } from '../schema/enums.ts';
import { normalizeCatalogPagination, parseCatalogDateRange } from './catalog-pagination.ts';
import type {
  CatalogFetchResult,
  ProductUpsertRow,
  VariationUpsertRow,
  PriceHistoryRow,
} from './catalog-pure.ts';

// ─── Tipos públicos (escrita — alinhados com schema Drizzle) ─────────

export type ProductRow = typeof products.$inferSelect;
export type VariationRow = typeof productVariations.$inferSelect;
export type PriceHistoryDbRow = typeof priceHistory.$inferSelect;

export type NewProduct = InferInsertModel<typeof products>;
export type NewVariation = InferInsertModel<typeof productVariations>;
export type NewPriceHistory = InferInsertModel<typeof priceHistory>;

// ─── Tipos públicos (leitura — contratos da API admin) ───────────────

export type CatalogMarketplace = (typeof marketplaceEnum.enumValues)[number];

export interface CatalogListFilters {
  marketplace?: CatalogMarketplace;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CatalogProductSummary {
  id: number;
  marketplace: CatalogMarketplace;
  marketplaceItemId: string;
  productKey: string;
  title: string | null;
  imageUrl: string | null;
  variationCount: number;
  minPrice: string | null;
  maxPrice: string | null;
  lastSeenAt: Date;
  lastCapturedAt: Date | null;
}

export interface CatalogListResponse {
  rows: CatalogProductSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CatalogVariation {
  id: number;
  productId: number;
  variationKey: string;
  variationId: string | null;
  variationName: string | null;
  attributesJson: Record<string, unknown>;
  lastSeenAt: Date;
}

export interface CatalogPricePoint {
  id: number;
  price: string;
  listPrice: string | null;
  currency: string;
  available: boolean;
  stock: number | null;
  capturedAt: Date;
  source: string;
}

export interface CatalogProductDetail {
  product: {
    id: number;
    marketplace: CatalogMarketplace;
    marketplaceItemId: string;
    productKey: string;
    title: string | null;
    imageUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
    lastSeenAt: Date;
  };
  variations: CatalogVariationWithHistory[];
}

export interface CatalogVariationWithHistory extends CatalogVariation {
  history: CatalogPricePoint[];
}

type DbProduct = InferSelectModel<typeof products>;
type DbVariation = InferSelectModel<typeof productVariations>;
type DbPricePoint = InferSelectModel<typeof priceHistory>;

const HISTORY_PREVIEW_LIMIT = 50;

// ─── Repository ──────────────────────────────────────────────────────

export class CatalogRepository {
  // ── Escrita (CatalogWorker) ─────────────────────────────────────────

  /**
   * Upsert em products por product_key.
   * Retorna o id da linha (criada ou atualizada).
   */
  async upsertProduct(row: ProductUpsertRow): Promise<number> {
    const db = getDb();
    const values: NewProduct = {
      marketplace: row.marketplace,
      marketplaceItemId: row.itemId,
      productKey: row.productKey,
      title: row.title ?? null,
      imageUrl: row.imageUrl ?? null,
    };

    const [inserted] = await db
      .insert(products)
      .values(values)
      .onConflictDoUpdate({
        target: products.productKey,
        set: {
          title: values.title,
          imageUrl: values.imageUrl,
          lastSeenAt: new Date(),
        },
      })
      .returning({ id: products.id });

    if (!inserted) throw new Error('upsertProduct: returning() vazio');
    return inserted.id;
  }

  /**
   * Upsert em product_variations por variation_key.
   * Retorna o id da linha (criada ou atualizada).
   */
  async upsertVariation(productId: number, row: VariationUpsertRow): Promise<number> {
    const db = getDb();
    const values: NewVariation = {
      productId,
      variationKey: row.variationKey,
      variationId: row.variationId ?? null,
      variationName: row.variationName ?? null,
      attributesJson: row.attributesJson,
    };

    const [inserted] = await db
      .insert(productVariations)
      .values(values)
      .onConflictDoUpdate({
        target: productVariations.variationKey,
        set: {
          variationName: values.variationName,
          variationId: values.variationId,
          attributesJson: values.attributesJson,
          lastSeenAt: new Date(),
        },
      })
      .returning({ id: productVariations.id });

    if (!inserted) throw new Error('upsertVariation: returning() vazio');
    return inserted.id;
  }

  /**
   * Append em price_history com dedup via índice único.
   *
   * Índice price_history_dedup_idx =
   *   (variation_id, price_bucket, price, list_price, available) NULLS NOT DISTINCT.
   *
   * ON CONFLICT DO NOTHING — concorrência de fan-out 1:N coberta sem
   * transação, sem race. Re-envio na mesma hora com mesmos valores
   * retorna inserted=false.
   */
  async appendPriceHistory(row: PriceHistoryRow): Promise<boolean> {
    const db = getDb();
    const values: NewPriceHistory = {
      variationId: row.variationId,
      price: row.price,
      listPrice: row.listPrice ?? null,
      currency: row.currency,
      available: row.available,
      stock: row.stock ?? null,
      priceBucket: row.priceBucket,
      capturedAt: row.capturedAt,
      source: row.source,
      sourceGroupJid: row.sourceGroupJid ?? null,
      messageId: row.messageId ?? null,
    };

    const result = await db
      .insert(priceHistory)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: priceHistory.id });

    return result.length > 0;
  }

  /**
   * Upsert encadeado: product → variation (×N) → append price_history (×N).
   *
   * Cada passo é idempotente (ON CONFLICT), então a sequência de statements
   * não precisa de transação explícita — replay do mesmo CatalogJob
   * converge sem race.
   */
  async upsertCatalog(fetch: CatalogFetchResult): Promise<{
    productId: number;
    variationIds: number[];
    insertedHistory: number;
  }> {
    const productId = await this.upsertProduct(fetch.product);

    const variationIds: number[] = [];
    let insertedHistory = 0;
    for (const v of fetch.variations) {
      const variationId = await this.upsertVariation(productId, v.row);
      const priceRow: PriceHistoryRow = { ...v.price, variationId };
      const inserted = await this.appendPriceHistory(priceRow);
      if (inserted) insertedHistory++;
      variationIds.push(variationId);
    }

    return { productId, variationIds, insertedHistory };
  }

  // ── Leitura (API admin) ─────────────────────────────────────────────

  async listProducts(filters: CatalogListFilters = {}): Promise<CatalogListResponse> {
    const db = getDb();
    const { page, pageSize, offset } = normalizeCatalogPagination(filters.page, filters.pageSize);

    const conditions = [];
    if (filters.marketplace) {
      conditions.push(eq(products.marketplace, filters.marketplace));
    }
    if (filters.search) {
      const escaped = escapeLike(filters.search);
      conditions.push(ilike(products.title, `%${escaped}%`));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(products)
      .where(where);
    const total = Number(totalRow?.total ?? 0);

    if (total === 0) {
      return { rows: [], total: 0, page, pageSize, totalPages: 1 };
    }

    const aggRows = await db
      .select({
        productId: products.id,
        variationCount: sql<number>`count(distinct ${productVariations.id})::int`,
        minPrice: sql<string | null>`min(${priceHistory.price})`,
        maxPrice: sql<string | null>`max(${priceHistory.price})`,
        lastCapturedAt: sql<Date | null>`max(${priceHistory.capturedAt})`,
      })
      .from(products)
      .leftJoin(productVariations, eq(productVariations.productId, products.id))
      .leftJoin(priceHistory, eq(priceHistory.variationId, productVariations.id))
      .where(where)
      .groupBy(products.id);

    const aggByProductId = new Map<number, (typeof aggRows)[number]>();
    for (const row of aggRows) aggByProductId.set(row.productId, row);

    const productRows = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(desc(products.lastSeenAt), desc(products.id))
      .limit(pageSize)
      .offset(offset);

    const rows: CatalogProductSummary[] = productRows.map((p) => {
      const agg = aggByProductId.get(p.id);
      return {
        id: p.id,
        marketplace: p.marketplace,
        marketplaceItemId: p.marketplaceItemId,
        productKey: p.productKey,
        title: p.title,
        imageUrl: p.imageUrl,
        variationCount: agg?.variationCount ?? 0,
        minPrice: agg?.minPrice ?? null,
        maxPrice: agg?.maxPrice ?? null,
        lastSeenAt: p.lastSeenAt,
        lastCapturedAt: agg?.lastCapturedAt ?? null,
      };
    });

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getProductWithVariations(productId: number): Promise<CatalogProductDetail | null> {
    const db = getDb();

    const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1);
    if (!product) return null;

    const variations = await db
      .select()
      .from(productVariations)
      .where(eq(productVariations.productId, productId))
      .orderBy(asc(productVariations.id));

    const variationsWithHistory: CatalogVariationWithHistory[] = [];
    for (const v of variations) {
      const history = await db
        .select()
        .from(priceHistory)
        .where(eq(priceHistory.variationId, v.id))
        .orderBy(desc(priceHistory.capturedAt))
        .limit(HISTORY_PREVIEW_LIMIT);
      variationsWithHistory.push({
        id: v.id,
        productId: v.productId,
        variationKey: v.variationKey,
        variationId: v.variationId,
        variationName: v.variationName,
        attributesJson: v.attributesJson ?? {},
        lastSeenAt: v.lastSeenAt,
        history: history.map(mapPricePoint),
      });
    }

    return {
      product: {
        id: product.id,
        marketplace: product.marketplace,
        marketplaceItemId: product.marketplaceItemId,
        productKey: product.productKey,
        title: product.title,
        imageUrl: product.imageUrl,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        lastSeenAt: product.lastSeenAt,
      },
      variations: variationsWithHistory,
    };
  }

  async getVariationHistory(
    variationId: number,
    options: { from?: string; to?: string } = {},
  ): Promise<CatalogPricePoint[] | null> {
    const db = getDb();

    const [variation] = await db
      .select({ id: productVariations.id })
      .from(productVariations)
      .where(eq(productVariations.id, variationId))
      .limit(1);
    if (!variation) return null;

    const { fromDate, toDate } = parseCatalogDateRange(options.from, options.to);

    const conditions = [eq(priceHistory.variationId, variationId)];
    if (fromDate) conditions.push(gte(priceHistory.capturedAt, fromDate));
    if (toDate) conditions.push(lte(priceHistory.capturedAt, toDate));

    const rows = await db
      .select()
      .from(priceHistory)
      .where(and(...conditions))
      .orderBy(asc(priceHistory.capturedAt));

    return rows.map(mapPricePoint);
  }
}

function escapeLike(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

function mapPricePoint(row: DbPricePoint): CatalogPricePoint {
  return {
    id: row.id,
    price: String(row.price),
    listPrice: row.listPrice == null ? null : String(row.listPrice),
    currency: row.currency,
    available: row.available,
    stock: row.stock,
    capturedAt: row.capturedAt,
    source: row.source,
  };
}

export type {
  CatalogFetchResult,
  ProductUpsertRow,
  VariationUpsertRow,
  PriceHistoryRow,
} from './catalog-pure.ts';
export type { DbProduct, DbVariation, DbPricePoint };
