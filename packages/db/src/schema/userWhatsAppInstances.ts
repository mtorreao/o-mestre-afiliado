import { integer, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

/**
 * Tabela de instâncias WhatsApp conectadas via Evolution API.
 * Cada usuário pode ter uma ou mais instâncias.
 *
 * channel_type: preparado para canais futuros ('telegram', etc.)
 * rate_limit_max_msgs / rate_limit_window_sec: controle de envio por instância
 */
export const userWhatsAppInstances = omestre.table('user_whatsapp_instances', {
  id: serial('id').primaryKey(),

  // Vínculo com usuário da plataforma
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),

  // Dados da instância Evolution API
  instanceId: text('instance_id').notNull().unique(),
  apiKey: text('api_key'),

  // Tipo de canal: 'whatsapp' | 'telegram' (futuro)
  channelType: text('channel_type').notNull().default('whatsapp'),

  // Rate limit: N mensagens a cada X segundos para esta instância
  rateLimitMaxMsgs: integer('rate_limit_max_msgs').notNull().default(15),
  rateLimitWindowSec: integer('rate_limit_window_sec').notNull().default(300),

  // Status da conexão: 'disconnected' | 'connecting' | 'connected'
  status: text('status').notNull().default('disconnected'),

  // Metadados
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
