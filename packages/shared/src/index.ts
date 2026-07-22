/**
 * Tipos compartilhados entre os apps do ecossistema O Mestre Afiliado
 */

// ─── Resultados de conversão ─────────────────────────────────────────────

export interface ConversionResult {
  success: boolean;
  originalUrl: string;
  affiliateUrl: string | null;
  marketplace: Marketplace;
  method: ConversionMethod;
  error?: string;
}

export type Marketplace = 'shopee' | 'mercadolivre' | 'amazon' | 'unknown';

export type ConversionMethod =
  | 'api'        // API oficial (Shopee GraphQL, ML OAuth)
  | 'cookies'    // Simulação via cookies (ML Link Builder)
  | 'fallback'   // Parâmetros na URL (ML ?meliid=, Amazon ?tag=)
  | 'promozone'  // Redirect via go.promozone.ai
  | 'unknown';

// ─── Configuração ────────────────────────────────────────────────────────

export interface AffiliateConfig {
  shopee?: ShopeeConfig;
  mercadolivre?: MercadoLivreConfig;
  amazon?: AmazonConfig;
}

export interface ShopeeConfig {
  appId: string;
  secret: string;
}

export interface MercadoLivreConfig {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  meliid?: string;
  melitat?: string;
  affiliateTag?: string;
  cookies?: string;
}

export interface AmazonConfig {
  trackingId?: string;
}

// ─── Utilitários ─────────────────────────────────────────────────────────

export const MARKETPLACE_DOMAINS: Record<Marketplace, RegExp[]> = {
  shopee: [/shopee\.com\.br/i, /go\.promozone\.ai\/shopee/i],
  mercadolivre: [/mercadolivre\.com\.br/i, /meli\.la/i, /go\.promozone\.ai\/mercadolivre/i],
  amazon: [/amazon\.com\.br/i, /amzn\.to/i, /go\.promozone\.ai\/amazon/i],
  unknown: [],
} as const;

export function detectMarketplace(url: string): Marketplace {
  for (const [marketplace, patterns] of Object.entries(MARKETPLACE_DOMAINS)) {
    if (marketplace === 'unknown') continue;
    if (patterns.some((p) => p.test(url))) return marketplace as Marketplace;
  }
  return 'unknown';
}

// ─── Tipos do pipeline de espelhamento ──────────────────────────────────

export type { MirrorMessageEvent } from './mirror-message.ts';
export type { MirrorDLQEntry } from './mirror-message.ts';

// ─── Constantes do pipeline ────────────────────────────────────────────

// ─── Offer Validator ──────────────────────────────────────────────────

export {
  VALIDATION_MESSAGE_LIMIT,
  MIN_OFFER_RATIO,
  KNOWN_SHORTENER_DOMAINS,
  extractUrls,
  isKnownMarketplaceDomain,
  resolveUrl,
  isMessageValidOffer,
  validateGroup,
  validateOfferGroups,
  detectConnectionError,
} from './offer-validator.ts';
export type {
  GroupValidationResult,
  ValidationReport,
  FetchMessagesResult,
  FetchMessagesFn,
} from './offer-validator.ts';

/** (DEPRECATED) Canal Redis PubSub — mantido para referência */
export const MIRROR_MESSAGE_CHANNEL = 'omestre:mirror:message';

/** Stream Redis para fila persistente de mensagens de espelhamento */
export const MIRROR_STREAM = 'omestre:mirror:stream';

/** Nome do consumer group Redis Stream para os workers */
export const MIRROR_CONSUMER_GROUP = 'omestre:mirror:workers';

/** Prefixo para chave de cache de conversão de URLs no Redis */
export const MIRROR_CONVERSION_CACHE_PREFIX = 'mirror:conversion:';

/** TTL padrão para cache de conversão de URLs (1 hora em segundos) */
export const MIRROR_CONVERSION_CACHE_TTL = 3600;

/** Prefixo para chave da Dead Letter Queue no Redis */
export const MIRROR_DLQ_LIST = 'mirror:dlq:entries';

/** Sorted set para indexar itens da DLQ por timestamp */
export const MIRROR_DLQ_INDEX = 'mirror:dlq:index';

/** TTL padrão para itens na DLQ (7 dias em segundos) */
export const MIRROR_DLQ_TTL = 7 * 24 * 3600;
