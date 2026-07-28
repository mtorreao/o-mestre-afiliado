import { bigserial, jsonb, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';

/**
 * Logs estruturados enviados pela extensão Chrome para diagnóstico remoto.
 *
 * Auth: API key dedicada no header `X-Extension-Logs-Key` (escopo apenas inserir).
 * Retenção: 7 dias (cleanup job separado).
 */
export const extensionLogs = omestre.table('extension_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId: text('session_id').notNull(),
  userEmail: text('user_email'),
  level: text('level').notNull(),
  event: text('event').notNull(),
  data: jsonb('data'),
  extensionVersion: text('extension_version').notNull(),
  chromeVersion: text('chrome_version'),
  userAgent: text('user_agent'),
  receivedAt: timestamp('received_at').notNull().defaultNow(),
});
