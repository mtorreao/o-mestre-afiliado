/**
 * @omestre/db — Schema e conexão PostgreSQL via Drizzle ORM
 *
 * Schema isolado em "omestre" para não conflitar com o schema
 * "evolution_api" usado pela Evolution API.
 */

// ─── Conexão ───────────────────────────────────────────────────────────

export { getDb, closeDb, getClient, checkDbHealth } from './db.ts';

// ─── Schema ────────────────────────────────────────────────────────────

export {
  omestre,
  affiliates,
  mlAffiliates,
  reflectedOffers,
  marketplaceEnum,
  offerStatusEnum,
  users,
  userCredentials,
  userWhatsAppInstances,
} from './schema/index.ts';

export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ─── Repository ─────────────────────────────────────────────────────────

export { MlAffiliateRepository } from './repository/mlAffiliates.repository.ts';
export type {
  MlAffiliate,
  NewMlAffiliate,
  MlAffiliateSummary,
  MlAffiliateUpsertData,
  MlAffiliatePatchData,
} from './repository/mlAffiliates.repository.ts';

export { UserRepository } from './repository/users.repository.ts';
export type { User, NewUser, UserPublic } from './repository/users.repository.ts';

export { UserCredentialsRepository } from './repository/userCredentials.repository.ts';
export type { UserCredentials, NewUserCredentials, UserCredentialsInput } from './repository/userCredentials.repository.ts';

export { WhatsAppInstanceRepository } from './repository/whatsAppInstances.repository.ts';
export type { WhatsAppInstance, NewWhatsAppInstance, WhatsAppInstancePublic } from './repository/whatsAppInstances.repository.ts';

export { AffiliatesRepository } from './repository/affiliates.repository.ts';
export type { Affiliate, NewAffiliate, AffiliateGroupConfig } from './repository/affiliates.repository.ts';
