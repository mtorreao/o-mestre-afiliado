/**
 * @omestre/db — Schema e conexão PostgreSQL via Drizzle ORM
 *
 * Schema isolado em "omestre" para não conflitar com o schema
 * "evolution_api" usado pela Evolution API.
 */

// ─── Conexão ───────────────────────────────────────────────────────────

export { getDb, closeDb, getClient } from './db.ts';

// ─── Schema ────────────────────────────────────────────────────────────

export {
  omestre,
  affiliates,
  reflectedOffers,
  marketplaceEnum,
  offerStatusEnum,
} from './schema/index.ts';

export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
