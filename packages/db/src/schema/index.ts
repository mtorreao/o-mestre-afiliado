import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

// ─── Enums ──────────────────────────────────────────────────────────

export const marketplaceEnum = pgEnum('marketplace', ['shopee', 'mercadolivre', 'amazon', 'unknown']);

export const offerStatusEnum = pgEnum('offer_status', ['sent', 'failed', 'blocked']);

// ─── Afiliados (WhatsApp Worker) ────────────────────────────────────

export const affiliates = omestre.table('affiliates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),

  // Evolution API: nome da instance (ex: "affiliate-1")
  evolutionInstanceId: text('evolution_instance_id').unique(),

  // IDs dos grupos WhatsApp
  sourceGroups: jsonb('source_groups').$type<{ jid: string; name: string }[]>().default([]),
  targetGroups: jsonb('target_groups').$type<{ jid: string; name: string }[]>().default([]),

  // Grupos excluídos por validação (feedback visual persistente)
  excludedGroups: jsonb('excluded_groups')
    .$type<{
      groupJid: string;
      groupName: string;
      reason: string;
      ratio: number;
      totalMessages: number;
      validOffers: number;
    }[]>()
    .default([]),

  // Template personalizado da mensagem
  // Placeholders: {texto_original} = texto com link convertido, {link_convertido} = link convertido isolado
  // Default: "{texto_original}" (envia o texto original com o link trocado)
  messageTemplate: text('message_template'),

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

  // Configuração de notificações proativas
  notificationChannel: text('notification_channel').notNull().default('disabled'),
  notificationJid: text('notification_jid'),

  // Revalidação periódica
  lastValidatedAt: timestamp('last_validated_at', { mode: 'date' }),
  lastValidationPassed: boolean('last_validation_passed'),
  lastValidationReport: jsonb('last_validation_report')
    .$type<{
      overallRatio: number;
      totalMessages: number;
      totalValidOffers: number;
      groups: {
        groupJid: string;
        groupName: string;
        totalMessages: number;
        validOffers: number;
        ratio: number;
        passed: boolean;
      }[];
    }>(),

  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─── Afiliados ML (OAuth + Cookies) ─────────────────────────────────

export const mlAffiliates = omestre.table('ml_affiliates', {
  id: serial('id').primaryKey(),

  // Vínculo com usuário da plataforma
  userId: integer('user_id').references(() => users.id),

  // ML user ID (vem do OAuth)
  mlUserId: text('ml_user_id').notNull().unique(),

  // Apelido no ML (ex: "M.TORREAO")
  nickname: text('nickname').notNull(),

  // Tokens OAuth
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),

  // Expiração do access token
  expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),

  // Conexão
  connectedAt: timestamp('connected_at', { mode: 'date' }).notNull(),
  lastUsedAt: timestamp('last_used_at', { mode: 'date' }).notNull(),

  // URL params de fallback (formato antigo)
  meliid: text('meliid'),
  melitat: text('melitat'),

  // Cookies de sessão ML (para link curto meli.la)
  sessionCookies: text('session_cookies'),

  // Metadados
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// ─── Ofertas Refletidas ─────────────────────────────────────────────

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

  // Motivo da falha/bloqueio (ex: \"conversion_failed\", \"blocked:blacklist\", \"blocked:no_url\")
  failureReason: text('failure_reason'),
});

// ─── Índices ────────────────────────────────────────────────────────
// Índices serão adicionados via Drizzle quando necessário.

// ─── WhatsApp Instances ───────────────────────────────────────────
export { userWhatsAppInstances } from './userWhatsAppInstances.ts';

// ─── Espelhamentos (mirrors) ────────────────────────────────────────
export { mirrors } from './mirrors.ts';

// ─── Re-export dos schemas auxiliares ───────────────────────────────
export { omestre } from './omestre.ts';
export { users } from './users.ts';
export { userCredentials } from './userCredentials.ts';
