import { integer, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

/**
 * Credenciais de marketplace por usuário.
 * Uma única linha por usuário, contendo todas as credenciais
 * de marketplace que não usam OAuth (ex: Shopee App ID/Secret).
 *
 * Credenciais OAuth (Mercado Livre) ficam na tabela ml_affiliates,
 * vinculadas via user_id.
 */
export const userCredentials = omestre.table('user_credentials', {
  id: serial('id').primaryKey(),

  // FK para o usuário
  userId: integer('user_id')
    .notNull()
    .references(() => users.id),

  // Shopee
  shopeeAppId: text('shopee_app_id'),
  shopeeAppSecret: text('shopee_app_secret'),

  // Amazon
  amazonTrackingId: text('amazon_tracking_id'),

  // Metadados
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
