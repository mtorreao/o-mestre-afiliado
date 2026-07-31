/**
 * CatalogRepository -- leitura do catalogo de produtos (apenas SELECT).
 *
 * Conforme docs/plans/historico-precos.md secao 5.5.2: rotas expostas via API
 * admin (isAdmin=true). O historico e populado APENAS pelo CatalogWorker
 * (Queue C) -- este repositorio e estritamente read-only.
 */
import type { InferSelectModel } from 'drizzle-orm';
import { and, asc, desc, eq, gte, ilike, lte, sql } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { priceHistory, productVariations, products } from '../schema/index.ts';
import type { marketplaceEnum } from '../schema/enums.ts';
import { normalizeCatalogPagination, parseCatalogDateRange } from './catalog-pagination.ts';

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

export class CatalogRepository {
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

export type { DbProduct, DbVariation, DbPricePoint };
