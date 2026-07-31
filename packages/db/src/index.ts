/**
 * @omestre/db — Schema e conexão PostgreSQL via Drizzle ORM
 *
 * Schema isolado em "omestre" para não conflitar com o schema
 * "evolution_api" usado pela Evolution API.
 */

// ─── Conexão ───────────────────────────────────────────────────────────

export { getDb, closeDb, getClient, checkDbHealth } from './db.ts';

// ─── Criptografia ──────────────────────────────────────────────────────

export { encrypt, decrypt } from './crypto.ts';

// ─── Schema ────────────────────────────────────────────────────────────

export {
  omestre,
  affiliates,
  mlAffiliates,
  amazonAffiliates,
  magaluAffiliates,
  reflectedOffers,
  marketplaceEnum,
  offerStatusEnum,
  users,
  userCredentials,
  userWhatsAppInstances,
  mirrors,
  products,
  productVariations,
  priceHistory,
} from './schema/index.ts';

export type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
export type { AmazonTrackingId, AmazonRegion } from './schema/index.ts';

// ─── Repository ─────────────────────────────────────────────────────────

export { MlAffiliateRepository } from './repository/mlAffiliates.repository.ts';
export type {
  MlAffiliate,
  NewMlAffiliate,
  MlAffiliateSummary,
  MlAffiliateUpsertData,
  MlAffiliatePatchData,
} from './repository/mlAffiliates.repository.ts';

export { AmazonAffiliateRepository } from './repository/amazonAffiliates.repository.ts';
export type {
  AmazonAffiliate,
  NewAmazonAffiliate,
  AmazonAffiliateSummary,
  AmazonAffiliateUpsertData,
  AmazonTrackingIdInput,
} from './repository/amazonAffiliates.repository.ts';

export { UserRepository } from './repository/users.repository.ts';
export type { User, NewUser, UserPublic } from './repository/users.repository.ts';
export { isEmailAdminAllowed } from './repository/users-pure.ts';

export { UserCredentialsRepository } from './repository/userCredentials.repository.ts';
export type {
  UserCredentials,
  NewUserCredentials,
  UserCredentialsInput,
} from './repository/userCredentials.repository.ts';

export { WhatsAppInstanceRepository } from './repository/whatsAppInstances.repository.ts';
export type {
  WhatsAppInstance,
  NewWhatsAppInstance,
  WhatsAppInstancePublic,
} from './repository/whatsAppInstances.repository.ts';

export { AffiliatesRepository } from './repository/affiliates.repository.ts';
export type {
  Affiliate,
  NewAffiliate,
  NotificationConfig,
} from './repository/affiliates.repository.ts';

export { MirrorLogRepository } from './repository/mirrorLog.repository.ts';
export type {
  MirrorLogRow,
  MirrorLogFilters,
  MirrorLogResponse,
} from './repository/mirrorLog.repository.ts';

export { MirrorRepository } from './repository/mirrors.repository.ts';
export type {
  Mirror,
  NewMirror,
  MirrorListFilters,
  MirrorListResponse,
  MirrorUpdateData,
} from './repository/mirrors.repository.ts';

export { FeatureFlagRepository } from './repository/featureFlags.repository.ts';
export type { FeatureFlagRow, NewFeatureFlagRow } from './repository/featureFlags.repository.ts';
export { ExtensionLogRepository } from './repository/extensionLogs.repository.ts';
export type { InsertedLogRow } from './repository/extensionLogs.repository.ts';

export { CatalogRepository } from './repository/catalog.repository.ts';
export type {
  CatalogMarketplace,
  CatalogListFilters,
  CatalogProductSummary,
  CatalogListResponse,
  CatalogVariation,
  CatalogPricePoint,
  CatalogProductDetail,
  CatalogVariationWithHistory,
} from './repository/catalog.repository.ts';
