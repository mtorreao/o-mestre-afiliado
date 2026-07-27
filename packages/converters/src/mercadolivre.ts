/**
 * Mercado Livre Affiliate Link Converter
 *
 * Suporta duas estratégias (em ordem de prioridade):
 * 1. API OFICIAL - OAuth 2.0 (alto volume)
 * 2. FALLBACK - Parâmetros na URL (qualquer volume)
 *
 * Cookies de sessão (quando usados) são SEMPRE atrelados ao usuário
 * (extensão Chrome → banco via MlAffiliateRepository.session_cookies),
 * nunca lidos de variável de ambiente.
 *
 * A lógica PURA (montagem de payloads/URLs, parsing, classificação e
 * formatação de erros) vive em `mercadolivre-pure.ts`. Este arquivo
 * mantém SOMENTE a camada de I/O (fetch + cookies) e os pontos de
 * entrada públicos — nenhum header de auth ou lógica de fetch foi alterado.
 */

import { randomBytes } from 'node:crypto';
import type { ConversionResult } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';
import {
  buildConversionResult,
  buildCookiesRequestHeaders,
  buildErrorResult,
  buildLinkBuilderApiBody,
  buildLinkBuilderApiHeaders,
  buildNotMercadoLivreResult,
  buildOAuthHeaders,
  buildOAuthPayload,
  buildRefreshCookiesHeaders,
  canUseStrategy,
  extractMercadoLivreCredentials,
  extractMeliLaLink,
  extractShortenUrl,
  formatApiError,
  formatMetadataSessionId,
  formatMissingShortenUrlError,
  formatOAuthError,
  generateViaUrlParams as pureGenerateViaUrlParams,
  isLoginRedirect,
  isLoginRedirectStatus,
  isMeliLaShortUrl,
  isMercadoLivreUrl,
  mergeCookies as pureMergeCookies,
  OAUTH_NO_CREDENTIALS_MESSAGE,
  OAUTH_TOKEN_URL,
  LINK_BUILDER_API,
  LINK_BUILDER_PAGE,
  parseOAuthErrorBody,
  type MlConversionOptions,
  type MlStrategy,
  type MercadoLivreCredentials,
} from './mercadolivre-pure.ts';

// ─── Interfaces ────────────────────────────────────────────────────────────

interface AuthResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

interface LinkConversionResponse {
  shorten_url: string;
  long_url: string;
  status: string;
}

export type { MlConversionOptions, MlStrategy, MercadoLivreCredentials };

export function getCredentials(): MercadoLivreCredentials {
  return extractMercadoLivreCredentials(process.env);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AUTENTICAÇÃO OAUTH 2.0
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Obtém access_token via OAuth 2.0 (refresh_token ou authorization_code)
 */
export async function getAccessToken(
  clientId: string,
  clientSecret: string,
  code?: string,
  redirectUri?: string,
  refreshToken?: string,
): Promise<AuthResponse> {
  const payload = buildOAuthPayload({ clientId, clientSecret, code, redirectUri, refreshToken });

  if (!payload) {
    throw new Error(OAUTH_NO_CREDENTIALS_MESSAGE);
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: buildOAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = parseOAuthErrorBody(await res.text().catch(() => '{}')) as Record<string, unknown>;
    throw new Error(
      formatOAuthError(res.status, err.message as string | undefined, res.statusText),
    );
  }

  return res.json() as Promise<AuthResponse>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. LINK BUILDER API (OFICIAL)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Gera link de afiliado via API oficial do Link Builder
 */
export async function generateViaApi(productUrl: string, accessToken: string): Promise<string> {
  const res = await fetch(LINK_BUILDER_API, {
    method: 'POST',
    headers: buildLinkBuilderApiHeaders(accessToken),
    body: buildLinkBuilderApiBody(productUrl),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(formatApiError(res.status, text, res.statusText));
  }

  const data = (await res.json()) as LinkConversionResponse;

  const shortenUrl = extractShortenUrl(data);
  if (!shortenUrl) {
    throw new Error(formatMissingShortenUrlError(data));
  }

  return shortenUrl;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ABORDAGEM VIA COOKIES
// ═══════════════════════════════════════════════════════════════════════════════

function generateMetadataSessionId(): string {
  const random = randomBytes(16).toString('hex');
  const timestamp = Date.now().toString(36);
  return formatMetadataSessionId(timestamp, random);
}

/**
 * Gera um session ID para o header X-Metadata-Session-Id usado pelo
 * Link Builder do Mercado Livre. Exportado apenas para teste unitário.
 */
export function _testGenerateMetadataSessionId(): string {
  return generateMetadataSessionId();
}

/**
 * Tenta gerar link simulando o Link Builder via cookies
 */
export async function generateViaCookies(
  productUrl: string,
  cookies: string | undefined,
): Promise<string | null> {
  if (!cookies) return null;

  const metadataSessionId = generateMetadataSessionId();

  const res = await fetch(LINK_BUILDER_PAGE, {
    method: 'POST',
    headers: buildCookiesRequestHeaders(cookies, metadataSessionId),
    body: new URLSearchParams({ url: productUrl }),
    redirect: 'manual',
  });

  if (isLoginRedirectStatus(res.status)) {
    const location = res.headers.get('location') || '';
    if (isLoginRedirect(location)) {
      return null; // Cookies expirados
    }
  }

  if (!res.ok) return null;

  const text = await res.text();

  return extractMeliLaLink(text);
}

/**
 * Renova cookies de sessão acessando o Link Builder
 */
export async function refreshSessionCookies(currentCookies: string | undefined): Promise<string> {
  if (!currentCookies) return '';

  const res = await fetch(LINK_BUILDER_PAGE, {
    headers: buildRefreshCookiesHeaders(currentCookies),
    redirect: 'manual',
  });

  const newCookies = res.headers.get('set-cookie');
  if (newCookies) {
    return pureMergeCookies(currentCookies, newCookies);
  }

  return currentCookies;
}

/**
 * Mescla cookies existentes com novos Set-Cookie headers.
 * Exportado para compatibilidade com testes existentes (delega em pure).
 */
export function mergeCookies(existing: string, setCookie: string): string {
  return pureMergeCookies(existing, setCookie);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FALLBACK: PARÂMETROS NA URL
// ═══════════════════════════════════════════════════════════════════════════════

export function generateViaUrlParams(productUrl: string, creds: MercadoLivreCredentials): string {
  return pureGenerateViaUrlParams(productUrl, creds);
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════════════════════

async function resolveShortUrl(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, { method: 'HEAD', redirect: 'manual' });
    const location = res.headers.get('location');
    if (location) return location;

    if (res.status === 200) {
      const res2 = await fetch(shortUrl);
      return res2.url;
    }

    return shortUrl;
  } catch {
    return shortUrl;
  }
}

export { isMercadoLivreUrl };

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Converte uma URL do Mercado Livre em link de afiliado,
 * tentando estratégias em ordem até uma funcionar
 */
export async function convertMercadoLivreUrl(
  url: string,
  options?: MlConversionOptions,
): Promise<ConversionResult> {
  try {
    const marketplace = detectMarketplace(url);

    if (marketplace !== 'mercadolivre') {
      return buildNotMercadoLivreResult(url, marketplace);
    }

    const creds = getCredentials();

    // Resolver link curto meli.la
    let targetUrl = url;
    if (isMeliLaShortUrl(url)) {
      const resolved = await resolveShortUrl(url);
      if (resolved && resolved !== url) {
        targetUrl = resolved;
      }
    }

    let affiliateLink: string | null = null;
    let method: MlStrategy = 'none';

    const strategies = options?.prefer ?? ['api', 'cookies'];

    for (const strat of strategies) {
      if (strat === 'api' && canUseStrategy('api', creds)) {
        try {
          const auth = await getAccessToken(
            creds.clientId!,
            creds.clientSecret!,
            undefined,
            undefined,
            creds.refreshToken,
          );
          affiliateLink = await generateViaApi(targetUrl, auth.access_token);
          method = 'api';
          break;
        } catch {
          // Próxima estratégia
        }
      }

      if (strat === 'cookies' && canUseStrategy('cookies', creds)) {
        affiliateLink = await generateViaCookies(targetUrl, creds.cookies);
        if (!affiliateLink) {
          const newCookies = await refreshSessionCookies(creds.cookies);
          affiliateLink = await generateViaCookies(targetUrl, newCookies);
        }
        if (affiliateLink) {
          method = 'cookies';
          break;
        }
      }

      if (strat === 'fallback' && canUseStrategy('fallback', creds)) {
        affiliateLink = pureGenerateViaUrlParams(targetUrl, creds);
        method = 'fallback';
        break;
      }
    }

    return buildConversionResult(url, affiliateLink, method);
  } catch (error) {
    return buildErrorResult(url, error);
  }
}

/**
 * Converte URL do ML usando credenciais explícitas (para multi-afiliado).
 * Semelhante a convertMercadoLivreUrl, mas recebe access_token diretamente
 * em vez de ler do .env.
 */
export async function convertMercadoLivreUrlWithToken(
  url: string,
  accessToken: string,
): Promise<ConversionResult> {
  try {
    const marketplace = detectMarketplace(url);
    if (marketplace !== 'mercadolivre') {
      return buildNotMercadoLivreResult(url, marketplace);
    }

    // Resolver link curto meli.la
    let targetUrl = url;
    if (isMeliLaShortUrl(url)) {
      const resolved = await resolveShortUrl(url);
      if (resolved && resolved !== url) {
        targetUrl = resolved;
      }
    }

    const affiliateLink = await generateViaApi(targetUrl, accessToken);
    return {
      success: true,
      originalUrl: url,
      affiliateUrl: affiliateLink,
      marketplace: 'mercadolivre',
      method: 'api',
    };
  } catch (error) {
    return buildErrorResult(url, error);
  }
}
