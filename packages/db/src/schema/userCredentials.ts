import { integer, serial, text, timestamp } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

/**
 * Credenciais de marketplace por usuário.
 * Uma única linha por usuário, contendo todas as credenciais
 * de marketplace que não usam OAuth (ex: Shopee App ID/Secret).
 *
 * Credenciais OAuth (Mercado Livre, Amazon) ficam em tabelas dedicadas:
 *   - Mercado Livre → `ml_affiliates` (vinculada via user_id)
 *   - Amazon        → `amazon_affiliates` (vinculada 1:1 via user_id UNIQUE)
 *
 * Tracking IDs Amazon ficam em `amazon_affiliates.tracking_ids` (jsonb).
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

  // Metadados
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
