/**
 * Lógica PURA do conversor de Mercado Livre.
 *
 * Separa a montagem de payloads/URLs/headers, o parsing/classificação de
 * respostas e a extração de links de afiliado da camada de I/O (fetch).
 * Todas as funções aqui são síncronas, não dependem de rede e são 100%
 * testáveis.
 *
 * O I/O (fetch + cookies de sessão + OAuth) fica em `mercadolivre.ts`,
 * que consome este módulo. Nenhuma lógica de auth/fetch é alterada aqui.
 */

// ─── Interfaces compartilhadas ─────────────────────────────────────────

import type { ConversionMethod, Marketplace } from '@omestre/shared';

export interface MercadoLivreCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  meliid?: string;
  melitat?: string;
  simpleTag?: string;
  cookies?: string;
}

export type MlStrategy = 'api' | 'cookies' | 'fallback' | 'none';

export interface MlConversionOptions {
  prefer?: MlStrategy[];
}

// ─── Session id (X-Metadata-Session-Id) ────────────────────────────────

/**
 * Monta o session id do header X-Metadata-Session-Id a partir de partes
 * puras (timestamp em base36 e hex aleatório). A geração dos valores
 * aleatórios fica em `mercadolivre.ts`; aqui só formatamos a string.
 */
export function formatMetadataSessionId(timestamp36: string, randomHex: string): string {
  return `${timestamp36}-${randomHex}`;
}

// ─── OAuth 2.0 ─────────────────────────────────────────────────────────

export interface OAuthPayloadInput {
  clientId: string;
  clientSecret: string;
  code?: string;
  redirectUri?: string;
  refreshToken?: string;
}

/**
 * Monta o payload do POST /oauth/token (refresh_token ou authorization_code).
 * Retorna `null` quando nem refreshToken nem code+redirectUri foram
 * fornecidos — caso em que o caller deve lançar erro de configuração.
 * Função pura: não faz fetch.
 */
export function buildOAuthPayload(input: OAuthPayloadInput): Record<string, string> | null {
  if (input.refreshToken) {
    return {
      grant_type: 'refresh_token',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
    };
  }

  if (input.code && input.redirectUri) {
    return {
      grant_type: 'authorization_code',
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    };
  }

  return null;
}

/** Formata a mensagem de erro para respostas HTTP não-ok do OAuth. */
export function formatOAuthError(
  status: number,
  message: string | undefined,
  statusText: string,
): string {
  return `OAuth erro ${status}: ${message || statusText}`;
}

// ─── API oficial do Link Builder (generateViaApi) ──────────────────────

export interface LinkConversionResponse {
  shorten_url: string;
  long_url: string;
  status: string;
}

/** Extrai o shorten_url da resposta crua; null se ausente (caller lança). */
export function extractShortenUrl(
  data: LinkConversionResponse | Record<string, unknown>,
): string | null {
  const shorten = (data as LinkConversionResponse).shorten_url;
  return shorten ? shorten : null;
}

/** Formata a mensagem de erro para respostas HTTP não-ok do Link Builder API. */
export function formatApiError(status: number, text: string, statusText: string): string {
  return `ML API erro ${status}: ${text || statusText}`;
}

// ─── Fallback via cookies (generateViaCookies) ─────────────────────────

/**
 * Detecta se o redirect da página do Link Builder indica login/cookies
 * expirados (location contém 'login' ou 'lgz').
 */
export function isLoginRedirect(location: string): boolean {
  return location.includes('login') || location.includes('lgz');
}

/**
 * Extrai o link curto meli.la do HTML retornado pelo Link Builder via
 * cookies. Tenta primeiro o padrão `meli.la/XXX` solto e, em seguida,
 * um `href="https://meli.la/..."`. Retorna null se nenhum for encontrado.
 */
export function extractMeliLaLink(text: string): string | null {
  const linkMatch = text.match(/meli\.la\/[A-Za-z0-9]+/);
  if (linkMatch) return `https://${linkMatch[0]}`;

  const redirectMatch = text.match(/href="(https:\/\/meli\.la\/[^"]+)"/);
  if (redirectMatch?.[1]) return redirectMatch[1];

  return null;
}

// ─── Merge de cookies ──────────────────────────────────────────────────

/**
 * Mescla cookies existentes com novos Set-Cookie headers.
 * Mantém só o valor (descarta atributos como Path/Expires/HttpOnly).
 * Exportado para teste unitário.
 */
export function mergeCookies(existing: string, setCookie: string): string {
  const cookieMap = new Map<string, string>();

  existing.split(';').forEach((c) => {
    const [key, ...rest] = c.trim().split('=');
    if (key) cookieMap.set(key.trim(), rest.join('='));
  });

  setCookie.split(',').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (key && !key.includes(' ')) {
      const value = (rest.join('=').split(';')[0] as string | undefined) ?? '';
      cookieMap.set(key.trim(), value);
    }
  });

  return Array.from(cookieMap.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// ─── Fallback: parâmetros na URL (generateViaUrlParams) ────────────────

/**
 * Gera link de afiliado do ML via parâmetros na URL (fallback, sem API).
 *
 *  - meliid + melitat → formato antigo (Clube de Afiliados)
 *  - simpleTag        → ?tag=...
 *  - só melitat       → novo formato (matt_word + matt_tool fixo)
 *  - só meliid        → ?meliid=...
 *
 * Lança se nenhuma credencial de fallback estiver presente.
 */
export function generateViaUrlParams(productUrl: string, creds: MercadoLivreCredentials): string {
  const { meliid, melitat, simpleTag } = creds;

  if (!meliid && !melitat && !simpleTag) {
    throw new Error('Nenhuma credencial de fallback (ML_MELIID, ML_MELITAT ou ML_AFFILIATE_TAG)');
  }

  const url = new URL(productUrl);

  if (meliid && melitat) {
    // Formato antigo (Clube de Afiliados): meliid + melitat
    url.searchParams.set('meliid', meliid);
    url.searchParams.set('melitat', melitat);
  } else if (simpleTag) {
    url.searchParams.set('tag', simpleTag);
  } else if (!meliid && melitat) {
    // Novo formato (Programa Afiliados e Criadores): matt_word + matt_tool
    url.searchParams.set('matt_word', melitat);
    url.searchParams.set('matt_tool', '71835809');
  } else {
    if (meliid) url.searchParams.set('meliid', meliid);
    if (melitat) url.searchParams.set('melitat', melitat);
  }

  return url.toString();
}

// ─── Detecção de marketplace / link curto ──────────────────────────────

const MELI_LA_REGEX = /meli\.la\/([A-Za-z0-9]+)/;

/** Detecta se a URL é do Mercado Livre (mercadolivre.com.br ou meli.la). */
export function isMercadoLivreUrl(url: string): boolean {
  return /mercadolivre\.com\.br/i.test(url) || /meli\.la/i.test(url);
}

/** Detecta se a URL é um link curto meli.la (precisa de resolução). */
export function isMeliLaShortUrl(url: string): boolean {
  return MELI_LA_REGEX.test(url);
}

// ─── Resultado de conversão (sem rede) ─────────────────────────────────

export interface MlConversionResult {
  success: boolean;
  originalUrl: string;
  affiliateUrl: string | null;
  marketplace: Marketplace;
  method: ConversionMethod;
  error?: string;
}

/** Monta o ConversionResult de "URL não é do Mercado Livre". */
export function buildNotMercadoLivreResult(
  url: string,
  marketplace: Marketplace,
): MlConversionResult {
  return {
    success: false,
    originalUrl: url,
    affiliateUrl: null,
    marketplace,
    method: 'unknown',
    error: 'URL não é do Mercado Livre',
  };
}

/** Monta o ConversionResult de erro genérico (catch). */
export function buildErrorResult(url: string, error: unknown): MlConversionResult {
  return {
    success: false,
    originalUrl: url,
    affiliateUrl: null,
    marketplace: 'mercadolivre',
    method: 'unknown',
    error: error instanceof Error ? error.message : String(error),
  };
}

/** Monta o ConversionResult de sucesso/erro a partir do link e método. */
export function buildConversionResult(
  url: string,
  affiliateLink: string | null,
  method: MlStrategy,
): MlConversionResult {
  return {
    success: !!affiliateLink,
    originalUrl: url,
    affiliateUrl: affiliateLink,
    marketplace: 'mercadolivre',
    method: method === 'none' ? 'unknown' : method,
    error: affiliateLink ? undefined : 'Nenhuma estratégia conseguiu gerar o link',
  };
}

// ─── Constantes e builders de I/O (consumidos por mercadolivre.ts) ──────

/** URL do token OAuth 2.0 do Mercado Livre. */
export const OAUTH_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';

/** Endpoint da API oficial do Link Builder. */
export const LINK_BUILDER_API = 'https://www.mercadolivre.com.br/afiliados/api/link-builder';

/** URL da página do Link Builder (fallback via cookies). */
export const LINK_BUILDER_PAGE = 'https://www.mercadolivre.com.br/afiliados/link-builder';

/** User-Agent usado nas requisições via cookies. */
export const COOKIES_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

/** Mensagem de erro quando nenhuma credencial OAuth é fornecida. */
export const OAUTH_NO_CREDENTIALS_MESSAGE =
  'Forneça ML_REFRESH_TOKEN para refresh, ou ML_AUTH_CODE + ML_REDIRECT_URI para authorization_code';

/** Extrai as credenciais do Mercado Livre a partir de um mapa de env.
 *  Função pura: injetamos o objeto de env para testabilidade. */
export function extractMercadoLivreCredentials(
  env: Record<string, string | undefined>,
): MercadoLivreCredentials {
  return {
    clientId: env.ML_CLIENT_ID,
    clientSecret: env.ML_CLIENT_SECRET,
    refreshToken: env.ML_REFRESH_TOKEN,
    meliid: env.ML_MELIID,
    melitat: env.ML_MELITAT,
    simpleTag: env.ML_AFFILIATE_TAG,
    // cookies: SEMPRE vem do banco (user-tied via extensão Chrome),
    // Nunca ler de variável de ambiente.
  };
}

/**
 * Monta os headers do POST no OAuth token.
 * Função pura: só formata strings.
 */
export function buildOAuthHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: 'application/json' };
}

/**
 * Monta os headers do POST na API oficial do Link Builder.
 * `accessToken` vem do OAuth. Função pura: só formata strings.
 */
export function buildLinkBuilderApiHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Monta o body do POST na API oficial do Link Builder.
 * Função pura: só interpola a productUrl.
 */
export function buildLinkBuilderApiBody(productUrl: string): string {
  return JSON.stringify({ url: productUrl });
}

/**
 * Monta os headers do POST na página do Link Builder (fallback cookies).
 * Função pura: só formata strings a partir dos cookies/sessionId.
 */
export function buildCookiesRequestHeaders(
  cookies: string,
  metadataSessionId: string,
): Record<string, string> {
  return {
    Cookie: cookies,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': COOKIES_USER_AGENT,
    'X-Metadata-Session-Id': metadataSessionId,
  };
}

/**
 * Monta os headers do GET de renovação de cookies de sessão.
 * Função pura: só formata strings a partir dos cookies.
 */
export function buildRefreshCookiesHeaders(cookies: string): Record<string, string> {
  return {
    Cookie: cookies,
    'User-Agent': COOKIES_USER_AGENT,
  };
}

/**
 * Verifica se o redirect (302/301) da página do Link Builder aponta para
 * login/cookies expirados. Função pura.
 */
export function isLoginRedirectStatus(status: number): boolean {
  return status === 302 || status === 301;
}

/** Formata a mensagem de erro quando a API do Link Builder não retorna shorten_url. */
export function formatMissingShortenUrlError(data: unknown): string {
  return `ML API não retornou shorten_url: ${JSON.stringify(data)}`;
}

/**
 * Efetua o parse do corpo de erro do OAuth (resposta não-ok).
 * Função pura: faz cast/leitura; retorna {} se o JSON for inválido.
 */
export function parseOAuthErrorBody(text: string): { message?: string } {
  try {
    return (JSON.parse(text) as { message?: string }) ?? {};
  } catch {
    return {};
  }
}

/**
 * Classifica se uma estratégia deve ser tentada com as credenciais dadas.
 * Retorna true quando a estratégia tem credenciais suficientes.
 * Função pura: só lê as credenciais.
 */
export function canUseStrategy(strategy: MlStrategy, creds: MercadoLivreCredentials): boolean {
  switch (strategy) {
    case 'api':
      return !!creds.clientId && !!creds.clientSecret;
    case 'cookies':
      return !!creds.cookies;
    case 'fallback':
      return !!(creds.meliid || creds.melitat || creds.simpleTag);
    default:
      return false;
  }
}
