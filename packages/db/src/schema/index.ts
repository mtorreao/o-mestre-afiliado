import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Schema "omestre" — isolado do schema "evolution_api" usado pela Evolution API.
 */
export const omestre = pgSchema('omestre');

// ─── Enums ────────────────────────────────────────────────────────────

export const marketplaceEnum = pgEnum('marketplace', ['shopee', 'mercadolivre', 'amazon', 'unknown']);

export const offerStatusEnum = pgEnum('offer_status', ['sent', 'failed']);

// ─── Afiliados ─────────────────────────────────────────────────────────

export const affiliates = omestre.table('affiliates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),

  // Evolution API: nome da instance (ex: "affiliate-1")
  evolutionInstanceId: text('evolution_instance_id').unique(),

  // IDs dos grupos WhatsApp
  sourceGroups: jsonb('source_groups').$type<{ jid: string; name: string }[]>().default([]),
  targetGroups: jsonb('target_groups').$type<{ jid: string; name: string }[]>().default([]),

  // Filtros (blacklist, keywords, dedup)
  filters: jsonb('filters')
    .$type<{
      blacklist: string[];
      keywords: string[];
      dedupHours: number;
    }>()
    .default({ blacklist: [], keywords: [], dedupHours: 24 }),

  // Credenciais criptografadas (AES-256-GCM)
  credentialsEncrypted: text('credentials_encrypted'),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─── Ofertas Refletidas ────────────────────────────────────────────────

export const reflectedOffers = omestre.table('reflected_offers', {
  id: serial('id').primaryKey(),
  affiliateId: integer('affiliate_id')
    .notNull()
    .references(() => affiliates.id),

  sourceGroupJid: text('source_group_jid').notNull(),
  targetGroupJid: text('target_group_jid').notNull(),

  originalLink: text('original_link').notNull(),
  convertedLink: text('converted_link').notNull(),
  marketplace: marketplaceEnum('marketplace').notNull(),

  messagePreview: text('message_preview'),
  mediaPath: text('media_path'),

  reflectedAt: timestamp('reflected_at').notNull().defaultNow(),
  status: offerStatusEnum('status').notNull().default('sent'),
});

// ─── Índices ───────────────────────────────────────────────────────────
// Índices serão adicionados via Drizzle quando necessário.
