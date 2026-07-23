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

export type Marketplace = 'shopee' | 'mercadolivre' | 'amazon' | 'magalu' | 'unknown';

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
  shopee: [/shopee\.com\.br/i, /s\.shopee\.com\.br/i, /shopee\.com/i, /go\.promozone\.ai\/shopee/i, /go\.promozone\.ai\/shp/i],
  mercadolivre: [/mercadolivre\.com\.br/i, /mercadolibre\.com(\.[a-z]{2})?/i, /meli\.la/i, /go\.promozone\.ai\/mercadolivre/i, /go\.promozone\.ai\/ml/i, /go\.promozone\.ai\/mercadolibre/i],
  amazon: [/amazon\.com\.br/i, /amazon\.com/i, /amzn\.to/i, /go\.promozone\.ai\/amazon/i, /go\.promozone\.ai\/amzn/i, /go\.promozone\.ai\/amz/i],
  magalu: [/magalu\.com\.br/i, /maga\.lu/i, /go\.promozone\.ai\/magalu/i],
  unknown: [],
} as const;

export function detectMarketplace(url: string): Marketplace {
  for (const [marketplace, patterns] of Object.entries(MARKETPLACE_DOMAINS)) {
    if (marketplace === 'unknown') continue;
    if (patterns.some((p) => p.test(url))) return marketplace as Marketplace;
  }
  return 'unknown';
}

// ─── Template de Mensagem ───────────────────────────────────────────────

/** Contexto disponível para resolução de placeholders no template de mensagem */
export interface TemplateContext {
  /** Texto original completo da mensagem recebida */
  originalText: string;
  /** URL de marketplace detectada na mensagem original */
  originalUrl: string;
  /** URL convertida para link de afiliado (ou null se falhou) */
  convertedUrl: string | null;
  /** Marketplace detectado (shopee, mercadolivre, amazon, unknown) */
  marketplace: string;
  /** Nome do grupo de origem */
  sourceGroupName: string;
  /** Nome do grupo de destino (alvo do envio) */
  targetGroupName: string;
  /** Timestamp do processamento */
  timestamp: Date;
}

/** Mapa de marketplace → nome amigável em português */
export const MARKETPLACE_NAMES: Record<string, string> = {
  shopee: 'Shopee',
  mercadolivre: 'Mercado Livre',
  amazon: 'Amazon',
  magalu: 'Magalu',
  unknown: 'Desconhecido',
};

/** Lista de placeholders reconhecidos (para validação) */
export const KNOWN_PLACEHOLDERS = new Set([
  'texto_original',
  'link_convertido',
  'link_original',
  'marketplace',
  'marketplace_nome',
  'source_group',
  'target_group',
  'data',
  'hora',
  'data_hora',
]);

/**
 * Resolve placeholders simples em um template usando o contexto fornecido.
 *
 * Placeholders suportados:
 *   {texto_original}   — texto com link convertido
 *   {link_convertido}  — apenas o link de afiliado
 *   {link_original}    — URL original extraída
 *   {marketplace}      — identificador do marketplace (shopee, etc.)
 *   {marketplace_nome} — nome amigável (Shopee, Mercado Livre, etc.)
 *   {source_group}     — nome do grupo de origem
 *   {target_group}     — nome do grupo de destino
 *   {data}             — data atual (dd/MM/yyyy)
 *   {hora}             — hora atual (HH:mm)
 *   {data_hora}        — data e hora completas
 *
 * Placeholders não reconhecidos são mantidos como texto literal.
 * Placeholders condicionais ({?...}, {/}) são passados sem modificação.
 */
export function resolvePlaceholders(
  input: string,
  ctx: TemplateContext,
): string {
  let result = input;

  // Prepara o texto com link convertido
  let textWithConvertedLink = ctx.originalText;
  if (ctx.convertedUrl) {
    textWithConvertedLink = textWithConvertedLink.replace(ctx.originalUrl, ctx.convertedUrl);
  }

  const marketplaceNome = MARKETPLACE_NAMES[ctx.marketplace] ?? ctx.marketplace;
  const pad = (n: number) => String(n).padStart(2, '0');
  const data = `${pad(ctx.timestamp.getDate())}/${pad(ctx.timestamp.getMonth() + 1)}/${ctx.timestamp.getFullYear()}`;
  const hora = `${pad(ctx.timestamp.getHours())}:${pad(ctx.timestamp.getMinutes())}`;
  const dataHora = `${data} ${hora}`;

  // Substitui placeholders conhecidos
  result = result
    .replace(/\{texto_original\}/g, textWithConvertedLink)
    .replace(/\{link_convertido\}/g, ctx.convertedUrl ?? ctx.originalUrl)
    .replace(/\{link_original\}/g, ctx.originalUrl)
    .replace(/\{marketplace\}/g, ctx.marketplace)
    .replace(/\{marketplace_nome\}/g, marketplaceNome)
    .replace(/\{source_group\}/g, ctx.sourceGroupName)
    .replace(/\{target_group\}/g, ctx.targetGroupName)
    .replace(/\{data\}/g, data)
    .replace(/\{hora\}/g, hora)
    .replace(/\{data_hora\}/g, dataHora);

  return result;
}

/**
 * Extrai placeholders não reconhecidos de um template.
 * Ignora placeholders condicionais ({?...}, {:...}, {/}).
 * Retorna os placeholders desconhecidos encontrados (sem as chaves).
 */
export function findUnknownPlaceholders(template: string): string[] {
  const unknown: string[] = [];
  const placeholderRegex = /\{([a-z_]+)\}/gi;
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(template)) !== null) {
    const name = match[1]!;
    // Ignora condicionais (começam com ?, :, /) e placeholders conhecidos
    if (
      name.startsWith('?') ||
      name.startsWith(':') ||
      name.startsWith('/')
    ) continue;
    if (!KNOWN_PLACEHOLDERS.has(name)) {
      unknown.push(name);
    }
  }

  return unknown;
}

// ─── Parser de Condicionais ─────────────────────────────────────────────

export {
  evaluateCondition,
  processConditionals,
  buildEvalContext,
} from './template-parser.ts';
export type { TemplateEvalContext } from './template-parser.ts';

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
  detectMarketplaceByPath,
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
