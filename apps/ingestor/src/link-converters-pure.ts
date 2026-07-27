/**
 * link-converters-pure.ts — Lógica PURA (sem I/O) da conversão de links.
 *
 * Extraída de link-converters.ts para permitir 100% de cobertura via testes
 * unitários, sem rede/DB/Redis. A camada de I/O (resolveRedirectUrl,
 * repositórios, @omestre/converters) vive em `link-converters.ts`, que
 * importa e delega para as funções deste módulo.
 *
 * IMPORTANTE: este módulo NÃO deve importar de `link-converters.ts`
 * (circular import → TDZ). Só depende de funções puras do @omestre/shared.
 */
import { detectMarketplace } from '@omestre/shared';

// ─── Tipos ─────────────────────────────────────────────────────────────

/** Resultado padronizado de uma conversão de oferta. */
export interface ConversionResult {
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
  error?: string;
}

/** Shape estrutural do retorno dos conversores de @omestre/converters. */
export interface ConverterOutput {
  affiliateUrl: string | null;
  success: boolean;
  error?: string;
}

/** Shape estrutural do retorno de generateShortAffiliateLink (ML). */
export interface MlShortLinkOutput {
  success: boolean;
  shortUrl?: string | null;
  error?: string | null;
}

/** Classificação do resultado do Link Builder do ML. */
export type MlShortLinkOutcome =
  | { kind: 'success'; shortUrl: string }
  | { kind: 'cookie_error'; errorMsg: string }
  | { kind: 'rejected'; errorMsg: string };

// ─── Mensagens de erro (constantes puras) ──────────────────────────────

export const ML_NO_COOKIES_ERROR = 'Sem cookies de sessão ML para usar o Link Builder';

export const ML_NO_TAG_ERROR =
  'Afiliado ML sem tag (melitat) configurada. Reimporte os cookies pela extensão Chrome.';

// ─── Funções puras ─────────────────────────────────────────────────────

/**
 * Extrai o userId numérico de um `instanceName` no formato `user-{id}`.
 * Retorna `null` se não casar o padrão (ex: instância global da Evolution).
 */
export function extractUserIdFromInstanceName(
  instanceName: string | null | undefined,
): number | null {
  if (!instanceName) return null;
  const userIdMatch = instanceName.match(/^user-(\d+)$/);
  if (!userIdMatch) return null;
  const userId = parseInt(userIdMatch[1]!, 10);
  return Number.isNaN(userId) ? null : userId;
}

/** Monta o instanceName padrão `user-{id}` a partir do userId. */
export function buildInstanceName(userId: number): string {
  return `user-${userId}`;
}

/**
 * Decide o marketplace EFETIVO a partir da URL original e da resolvida.
 *
 * Regras:
 *  - Se a URL não redirecionou (resolvida === original) → mantém o detectado.
 *  - Se redirecionou e o marketplace resolvido é conhecido (`!=='unknown'`)
 *    → usa o resolvido (ex: shortlink meli.la → mercadolivre).
 *  - Caso contrário → mantém o detectado na original.
 */
export function resolveEffectiveMarketplace(
  originalMarketplace: string,
  originalUrl: string,
  resolvedUrl: string,
): string {
  if (resolvedUrl === originalUrl) return originalMarketplace;
  const resolvedMp = detectMarketplace(resolvedUrl);
  if (resolvedMp !== 'unknown') return resolvedMp;
  return originalMarketplace;
}

/**
 * Classifica se um marketplace é suportado pela conversão de afiliado.
 *
 * Retorna o nome amigável (PT-BR) se for um marketplace "conhecido mas sem
 * integração implementada" (bloqueado), ou `null` se for suportado / puder
 * cair no conversor global.
 */
export function classifyUnsupportedMarketplace(marketplace: string): string | null {
  const unsupportedMarketplaces: Record<string, string> = {
    magalu: 'Magalu (Magazine Luiza)',
  };
  return unsupportedMarketplaces[marketplace] ?? null;
}

/** Monta a mensagem de bloqueio para marketplace não integrado. */
export function buildUnsupportedMarketplaceError(unsupportedName: string): string {
  return `Marketplace ainda não liberado: ${unsupportedName}`;
}

/**
 * Converte o retorno de um conversor de @omestre/converters no shape
 * padronizado `ConversionResult`, anexando o marketplace efetivo.
 */
export function toConversionResult(marketplace: string, result: ConverterOutput): ConversionResult {
  return {
    convertedUrl: result.affiliateUrl,
    marketplace,
    success: result.success,
    error: result.error,
  };
}

/**
 * Converte um cache hit em `ConversionResult`. success reflete se o cache
 * armazenou uma conversão bem-sucedida (convertedUrl !== null).
 */
export function buildCachedConversionResult(cached: {
  convertedUrl: string | null;
  marketplace: string;
}): ConversionResult {
  return {
    convertedUrl: cached.convertedUrl,
    marketplace: cached.marketplace,
    success: cached.convertedUrl !== null,
  };
}

/** Monta um resultado de oferta bloqueada (falha com mensagem). */
export function buildBlockedResult(marketplace: string, error: string): ConversionResult {
  return { convertedUrl: null, marketplace, success: false, error };
}

/** Detecta se a URL é um shortlink de afiliado meli.la. */
export function isMeliLaShortlink(url: string): boolean {
  return /meli\.la/i.test(url);
}

/**
 * Decide se a URL do ML leva a uma página de PRODUTO elegível.
 *
 * Para shortlinks meli.la confia no `isProduct` retornado pelo resolvedor
 * de redirect (que já classificou a URL final). Para URLs diretas usa a
 * classificação da própria URL resolvida (`resolvedUrlIsProduct`).
 */
export function decideMeliProductStatus(
  originalUrl: string,
  resolvedIsProduct: boolean,
  resolvedUrlIsProduct: boolean,
): boolean {
  return isMeliLaShortlink(originalUrl) ? resolvedIsProduct : resolvedUrlIsProduct;
}

/** Monta a mensagem de bloqueio quando meli.la não leva a produto. */
export function buildMeliNotProductError(reason: string | undefined): string {
  return `meli.la não redireciona para produto: ${reason ?? 'not_product_url'}`;
}

/**
 * Classifica se um erro do Link Builder do ML indica cookies expirados/
 * inválidos (HTTP 40x, mensagem explícita ou unauthorized).
 */
export function isMlCookieError(errorMsg: string): boolean {
  return (
    errorMsg.includes('HTTP 40') ||
    errorMsg.includes('Cookies podem estar expirados') ||
    errorMsg.toLowerCase().includes('unauthorized')
  );
}

/**
 * Classifica o resultado do Link Builder do ML:
 *  - success + shortUrl → sucesso
 *  - erro de cookie → cookie_error (notificar afiliado)
 *  - qualquer outra falha → rejected (bloquear oferta)
 */
export function classifyMlShortLinkResult(shortResult: MlShortLinkOutput): MlShortLinkOutcome {
  if (shortResult.success && shortResult.shortUrl) {
    return { kind: 'success', shortUrl: shortResult.shortUrl };
  }
  const errorMsg = shortResult.error ?? 'erro desconhecido';
  if (isMlCookieError(errorMsg)) {
    return { kind: 'cookie_error', errorMsg };
  }
  return { kind: 'rejected', errorMsg };
}

/** Afiliado tem credenciais Shopee próprias (appId + secret)? */
export function hasShopeeCredentials(
  creds: { shopeeAppId?: string | null; shopeeAppSecret?: string | null } | null | undefined,
): boolean {
  return Boolean(creds?.shopeeAppId && creds?.shopeeAppSecret);
}

/** Afiliado Amazon tem pelo menos um tracking ID configurado? */
export function hasAmazonTrackingIds(
  affiliate: { trackingIds?: readonly unknown[] | null } | null | undefined,
): boolean {
  return Boolean(affiliate && (affiliate.trackingIds ?? []).length > 0);
}
