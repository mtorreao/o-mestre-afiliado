import { serial, text, integer, timestamp, uuid, index } from 'drizzle-orm/pg-core';
import { omestre } from './omestre.ts';
import { users } from './users.ts';

/**
 * Refresh tokens com rotação.
 *
 * Guardamos apenas o HASH do token opaco (nunca o valor cru), a família de
 * rotação (family_id) e o estado de revogação. Isso permite:
 *  - rotacionar: cada refresh revoga o anterior e emite um novo (mesmo family_id)
 *  - detectar replay: reuso de um token já revogado invalida a família inteira
 */
export const authRefreshTokens = omestre.table(
  'auth_refresh_tokens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    familyId: uuid('family_id').notNull(),
    revokedAt: timestamp('revoked_at'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_refresh_tokens_user_id').on(table.userId),
    index('idx_refresh_tokens_family_id').on(table.familyId),
  ],
);
