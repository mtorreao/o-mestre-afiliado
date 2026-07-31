/**
 * CatalogRepository — Operações de escrita no catálogo de produtos.
 *
 * Especificação: docs/plans/historico-precos.md §2.1-2.3, §3.2
 *
 * Três tabelas:
 *   - products          → upsert por product_key (UNIQUE)
 *   - product_variations → upsert por variation_key (UNIQUE)
 *   - price_history     → append com ON CONFLICT DO NOTHING
 *                         (dedup 1h via índice único NULLS NOT DISTINCT)
 *
 * Toda a montagem de payloads vive em catalog-pure.ts (funções PURAS,
 * testáveis sem DB). Este arquivo só faz o I/O via getDb().
 *
 * Populado exclusivamente pelo CatalogWorker (Queue C).
 */
import type { InferInsertModel } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { products, productVariations, priceHistory } from '../schema/index.ts';
import type {
  CatalogFetchResult,
  ProductUpsertRow,
  VariationUpsertRow,
  PriceHistoryRow,
} from './catalog-pure.ts';

// ─── Tipos públicos (alinhados com schema Drizzle) ────────────────────

export type ProductRow = typeof products.$inferSelect;
export type VariationRow = typeof productVariations.$inferSelect;
export type PriceHistoryDbRow = typeof priceHistory.$inferSelect;

export type NewProduct = InferInsertModel<typeof products>;
export type NewVariation = InferInsertModel<typeof productVariations>;
export type NewPriceHistory = InferInsertModel<typeof priceHistory>;

// ─── Repository ──────────────────────────────────────────────────────

export class CatalogRepository {
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
}

export type {
  CatalogFetchResult,
  ProductUpsertRow,
  VariationUpsertRow,
  PriceHistoryRow,
} from './catalog-pure.ts';
