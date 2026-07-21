import { integer, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

/**
 * Tabela de instâncias WhatsApp conectadas via Evolution API.
 * Cada usuário pode ter uma ou mais instâncias.
 */
export const userWhatsAppInstances = omestre.table('user_whatsapp_instances', {
  id: serial('id').primaryKey(),

  // Vínculo com usuário da plataforma
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),

  // Dados da instância Evolution API
  instanceId: text('instance_id').notNull().unique(),
  apiKey: text('api_key').notNull(),

  // Status da conexão: 'disconnected' | 'connecting' | 'connected'
  status: text('status').notNull().default('disconnected'),

  // Metadados
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
