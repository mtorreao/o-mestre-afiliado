/**
 * Schema da tabela de afiliados Amazon (multi-tracking ID).
 *
 * Cada afiliado da plataforma tem UMA linha em `amazon_affiliates`
 * (UNIQUE(user_id)) e pode cadastrar ATÉ 100 tracking IDs (limite
 * do Amazon Associates) em `tracking_ids` (jsonb).
 *
 * O Amazon Associates permite 1 Store ID + até 100 Tracking IDs.
 * Aqui modelamos apenas os tracking IDs (o Store ID é implícito
 * — todo tracking ID já carrega o store prefix, ex: "meusite-20").
 *
 * Shape do array `tracking_ids`:
 *   [{ tag: string, label?: string, region: 'BR'|'US'|'MX'|...,
 *      active: boolean, isDefault: boolean,
 *      createdAt: string }]
 *
 * - `tag`: tracking ID completo (ex: "meusite-20", "meusite-tg-20")
 * - `label`: descrição amigável ("Telegram", "Site principal", etc)
 * - `region`: região do sufixo (-20 = BR/US/CA/MX, -21 = UK/DE/FR/etc, -22 = JP/AU)
 * - `active`: false = ignorado na conversão
 * - `isDefault`: qual tracking usar quando o mirror não especificar
 */
import { boolean, integer, jsonb, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

export type AmazonRegion = 'BR' | 'US' | 'CA' | 'MX' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES' | 'JP' | 'AU' | 'OTHER';

export interface AmazonTrackingId {
  tag: string;
  label?: string;
  region: AmazonRegion;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
}

export const amazonAffiliates = omestre.table('amazon_affiliates', {
  id: serial('id').primaryKey(),

  // 1:1 com usuário da plataforma
  userId: integer('user_id')
    .notNull()
    .unique()
    .references(() => users.id),

  // Apelido (ex: "Matheus Afiliado", "Loja do Zé")
  nickname: text('nickname'),

  // Array de tracking IDs (jsonb). Default = [] vazio.
  trackingIds: jsonb('tracking_ids')
    .$type<AmazonTrackingId[]>()
    .notNull()
    .default([]),

  // Status: true = ativo, false = pausado
  active: boolean('active').notNull().default(true),

  connectedAt: timestamp('connected_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
