/**
 * Schema da tabela de variações de produto (product_variations).
 *
 * 1:N com products — cada variação do marketplace (ML: variation_id;
 * Shopee/Amazon: variação única implícita) vira uma linha, com o label
 * legível (`variation_name`) e os atributos crus (`attributes_json`).
 *
 * Populado pelo CatalogWorker (Queue C).
 * Especificação: docs/plans/historico-precos.md §2.2
 */
import { integer, jsonb, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { products } from './products.ts';

export const productVariations = omestre.table('product_variations', {
  id: serial('id').primaryKey(),

  productId: integer('product_id')
    .notNull()
    .references(() => products.id, { onDelete: 'cascade' }),

  // `${product_key}:${vId}` (vId do MP ou hash do nome) — UNIQUE
  variationKey: text('variation_key').notNull().unique(),

  // id da variação no MP (ML: variation_id; Shopee/Amazon: null)
  variationId: text('variation_id'),

  // "Azul / M" ou "Conjunto 3un" (label legível)
  variationName: text('variation_name'),

  // Atributos crus (cor, tamanho, voltagem...)
  attributesJson: jsonb('attributes_json').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
});
