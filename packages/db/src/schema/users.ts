import { serial, text, timestamp, boolean } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';

/**
 * Tabela de usuários da plataforma.
 * Cada usuário tem seu próprio cadastro de afiliado
 * com credenciais por marketplace.
 */
export const users = omestre.table('users', {
  id: serial('id').primaryKey(),

  // Autenticação
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),

  // Papel
  // Bootstrap: aplicado em apps/api/src/modules/auth/auth.routes.ts via ADMIN_EMAILS (env).
  isAdmin: boolean('is_admin').notNull().default(false),

  // Metadados
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
