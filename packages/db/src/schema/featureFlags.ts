import { text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';

/**
 * Tabela de feature flags admin-only.
 *
 * Fonte da verdade para o sistema de feature flags.
 * Avaliação em memória com cache TTL de 10s (optionally invalidado via
 * Redis PubSub para propagação imediata).
 */
export const featureFlags = omestre.table('feature_flags', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
