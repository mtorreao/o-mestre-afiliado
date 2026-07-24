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
 */

import { createHash, randomBytes } from 'node:crypto';
import type { ConversionResult } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';

const MELI_LA_REGEX = /meli\.la\/([A-Za-z0-9]+)/;

const OAUTH_TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
const LINK_BUILDER_API = 'https://www.mercadolivre.com.br/afiliados/api/link-builder';
const LINK_BUILDER_PAGE = 'https://www.mercadolivre.com.br/afiliados/link-builder';

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

export interface MercadoLivreCredentials {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  meliid?: string;
  melitat?: string;
  simpleTag?: string;
  cookies?: string;
}

export function getCredentials(): MercadoLivreCredentials {
  return {
    clientId: process.env.ML_CLIENT_ID,
    clientSecret: process.env.ML_CLIENT_SECRET,
    refreshToken: process.env.ML_REFRESH_TOKEN,
    meliid: process.env.ML_MELIID,
    melitat: process.env.ML_MELITAT,
    simpleTag: process.env.ML_AFFILIATE_TAG,
    // cookies: SEMPRE vem do banco (user-tied via extensão Chrome)
    // Nunca ler de variável de ambiente
  };
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
  let payload: Record<string, string>;

  if (refreshToken) {
    payload = {
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    };
  } else if (code && redirectUri) {
    payload = {
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    };
  } else {
    throw new Error(
      'Forneça ML_REFRESH_TOKEN para refresh, ou ML_AUTH_CODE + ML_REDIRECT_URI para authorization_code',
    );
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`OAuth erro ${res.status}: ${(err.message as string) || res.statusText}`);
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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: productUrl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`ML API erro ${res.status}: ${text || res.statusText}`);
  }

  const data = (await res.json()) as LinkConversionResponse;

  if (!data.shorten_url) {
    throw new Error(`ML API não retornou shorten_url: ${JSON.stringify(data)}`);
  }

  return data.shorten_url;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. ABORDAGEM VIA COOKIES
// ═══════════════════════════════════════════════════════════════════════════════

function generateMetadataSessionId(): string {
  const random = randomBytes(16).toString('hex');
  const timestamp = Date.now().toString(36);
  return `${timestamp}-${random}`;
}

/**
 * Tenta gerar link simulando o Link Builder via cookies
 */
export async function generateViaCookies(productUrl: string, cookies: string | undefined): Promise<string | null> {
  if (!cookies) return null;

  const metadataSessionId = generateMetadataSessionId();

  const res = await fetch(LINK_BUILDER_PAGE, {
    method: 'POST',
    headers: {
      Cookie: cookies,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'X-Metadata-Session-Id': metadataSessionId,
    },
    body: new URLSearchParams({ url: productUrl }),
    redirect: 'manual',
  });

  if (res.status === 302 || res.status === 301) {
    const location = res.headers.get('location') || '';
    if (location.includes('login') || location.includes('lgz')) {
      return null; // Cookies expirados
    }
  }

  if (!res.ok) return null;

  const text = await res.text();

  const linkMatch = text.match(/meli\.la\/[A-Za-z0-9]+/);
  if (linkMatch) return `https://${linkMatch[0]}`;

  const redirectMatch = text.match(/href="(https:\/\/meli\.la\/[^"]+)"/);
  if (redirectMatch?.[1]) return redirectMatch[1];

  return null;
}

/**
 * Renova cookies de sessão acessando o Link Builder
 */
export async function refreshSessionCookies(currentCookies: string | undefined): Promise<string> {
  if (!currentCookies) return '';

  const res = await fetch(LINK_BUILDER_PAGE, {
    headers: {
      Cookie: currentCookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    redirect: 'manual',
  });

  const newCookies = res.headers.get('set-cookie');
  if (newCookies) {
    return mergeCookies(currentCookies, newCookies);
  }

  return currentCookies;
}

function mergeCookies(existing: string, setCookie: string): string {
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

// ═══════════════════════════════════════════════════════════════════════════════
// 4. FALLBACK: PARÂMETROS NA URL
// ═══════════════════════════════════════════════════════════════════════════════

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

export function isMercadoLivreUrl(url: string): boolean {
  return /mercadolivre\.com\.br/i.test(url) || /meli\.la/i.test(url);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

export type MlStrategy = 'api' | 'cookies' | 'fallback' | 'none';

export interface MlConversionOptions {
  prefer?: MlStrategy[];
}

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
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace,
        method: 'unknown',
        error: 'URL não é do Mercado Livre',
      };
    }

    const creds = getCredentials();

    // Resolver link curto meli.la
    let targetUrl = url;
    if (MELI_LA_REGEX.test(url)) {
      const resolved = await resolveShortUrl(url);
      if (resolved && resolved !== url) {
        targetUrl = resolved;
      }
    }

    let affiliateLink: string | null = null;
    let method: MlStrategy = 'none';

    const strategies = options?.prefer ?? ['api', 'cookies'];

    for (const strat of strategies) {
      if (strat === 'api' && creds.clientId && creds.clientSecret) {
        try {
          const auth = await getAccessToken(
            creds.clientId,
            creds.clientSecret,
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

      if (strat === 'cookies' && creds.cookies) {
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

      if (strat === 'fallback' && (creds.meliid || creds.melitat || creds.simpleTag)) {
        affiliateLink = generateViaUrlParams(targetUrl, creds);
        method = 'fallback';
        break;
      }
    }

    return {
      success: !!affiliateLink,
      originalUrl: url,
      affiliateUrl: affiliateLink,
      marketplace: 'mercadolivre',
      method: method === 'none' ? 'unknown' : method,
      error: affiliateLink ? undefined : 'Nenhuma estratégia conseguiu gerar o link',
    };
  } catch (error) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'mercadolivre',
      method: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
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
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace,
        method: 'unknown',
        error: 'URL não é do Mercado Livre',
      };
    }

    // Resolver link curto meli.la
    let targetUrl = url;
    if (MELI_LA_REGEX.test(url)) {
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
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'mercadolivre',
      method: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
