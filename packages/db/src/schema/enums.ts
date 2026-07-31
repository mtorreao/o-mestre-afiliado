/**
 * Enums compartilhados do schema omestre.
 *
 * Isolados em arquivo próprio para evitar circular dependency:
 * tabelas em arquivos separados (ex: products.ts) importam os enums
 * daqui, não de ./index.ts.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

export const marketplaceEnum = pgEnum('marketplace', [
  'shopee',
  'mercadolivre',
  'amazon',
  'magalu',
  'unknown',
]);

export const offerStatusEnum = pgEnum('offer_status', ['sent', 'failed', 'blocked']);
