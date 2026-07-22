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

// ─── Constantes do pipeline ────────────────────────────────────────────

/** Canal Redis para envio de mensagens de grupos de espelhamento */
export const MIRROR_MESSAGE_CHANNEL = 'omestre:mirror:message';
