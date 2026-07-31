/**
 * Schema da tabela de integração Magalu (Influenciador Magalu / Magazine Você).
 *
 * Cada afiliado da plataforma tem UMA linha em `magalu_affiliates`
 * (UNIQUE(user_id)) com um único `store_slug` — o nome da loja que o
 * afiliado escolheu no cadastro do programa Influenciador Magalu.
 *
 * Formato da URL de afiliado:
 *   https://www.magazinevoce.com.br/{storeSlug}/{slugProduto}/p/{productId}/...
 *
 * Não há API oficial da Magalu para validação de slug/ID — validação
 * é feita em runtime via redirect 200/404.
 */
import { boolean, integer, serial, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

export const magaluAffiliates = omestre.table(
  'magalu_affiliates',
  {
    id: serial('id').primaryKey(),

    // 1:1 com usuário da plataforma
    userId: integer('user_id')
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Apelido opcional (ex: "Matheus - Magalu")
    nickname: text('nickname'),

    // Slug da loja no Magazine Você (escolhido no cadastro, imutável após 24h)
    // Aparece na URL magazinevoce.com.br/{slug}/...
    storeSlug: text('store_slug').notNull(),

    // Status: true = ativo, false = pausado
    active: boolean('active').notNull().default(true),

    connectedAt: timestamp('connected_at').notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_magalu_affiliates_user_id').on(table.userId),
    index('idx_magalu_affiliates_active')
      .on(table.active)
      .where(sql`${table.active} = true`),
  ],
);
