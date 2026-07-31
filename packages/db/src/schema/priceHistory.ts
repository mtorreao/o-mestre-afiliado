/**
 * Schema da tabela de histórico de preços (price_history).
 *
 * Append-only: cada ponto de preço capturado por variação vira uma linha.
 * Deduplicação por janela de 1h via índice único
 * `price_history_dedup_idx (variation_id, price_bucket, price, list_price, available)`
 * + `ON CONFLICT DO NOTHING` — concorrência de fan-out coberta sem transação.
 *
 * Populado pelo CatalogWorker (Queue C).
 * Especificação: docs/plans/historico-precos.md §2.3
 */
import { boolean, integer, numeric, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { productVariations } from './productVariations.ts';

export const priceHistory = omestre.table('price_history', {
  id: serial('id').primaryKey(),

  variationId: integer('variation_id')
    .notNull()
    .references(() => productVariations.id, { onDelete: 'cascade' }),

  price: numeric('price', { precision: 12, scale: 2 }).notNull(),

  // Preço de tachado/original (ML: original_price); null se indisponível
  listPrice: numeric('list_price', { precision: 12, scale: 2 }),

  currency: text('currency').notNull().default('BRL'),

  // false = esgotado
  available: boolean('available').notNull().default(true),

  // Qtd disponível (ML sim; Shopee/others null)
  stock: integer('stock'),

  // date_trunc('hour', captured_at) — base da deduplicação
  priceBucket: timestamp('price_bucket').notNull(),

  capturedAt: timestamp('captured_at').notNull().defaultNow(),

  // 'background' | 'manual' | 'api' | 'backfill'
  source: text('source').notNull().default('background'),

  // Grupo de onde veio (contexto)
  sourceGroupJid: text('source_group_jid'),

  // msgId original (rastreabilidade)
  messageId: text('message_id'),
});
