/**
 * Schema da tabela de catálogo de produtos (products).
 *
 * Normalização de produto: UMA linha por product_key
 * (`${marketplace}:${marketplace_item_id}`), independente de quantas
 * vezes o produto apareceu em mensagens espelhadas.
 *
 * Populado pelo CatalogWorker (Queue C) — nada além dele escreve aqui.
 * Especificação: docs/plans/historico-precos.md §2.1
 */
import { serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { marketplaceEnum } from './enums.ts';

export const products = omestre.table('products', {
  id: serial('id').primaryKey(),

  marketplace: marketplaceEnum('marketplace').notNull(),
  marketplaceItemId: text('marketplace_item_id').notNull(),

  // `${marketplace}:${marketplace_item_id}` — dedup real (UNIQUE)
  productKey: text('product_key').notNull().unique(),

  title: text('title'),
  imageUrl: text('image_url'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
});
