/**
 * @omestre/converters — Geração programática de links curtos ML (meli.la)
 * =============================================================================
 * Usa a API interna do Link Builder do Mercado Livre, descoberta via
 * inspeção de rede (Playwright) no painel de afiliados.
 *
 * Requer cookies de sessão do ML (não OAuth Bearer token).
 *
 * Renovação automática de cookies: quando o createLink responde 401/403
 * (cookies expirados) — ou a página do Link Builder não expõe o CSRF —
 * faz um GET na página com os cookies atuais, captura os headers
 * `set-cookie` e mescla com `mergeCookies()`. Se a renovação produziu
 * cookies novos, refaz o fluxo (CSRF + createLink) com eles. Falha na
 * renovação → erro com marcador de cookie expirado para o chamador cair
 * no fallback de URL params.
 *
 * Cache de CSRF por afiliado: a chave é `tag + fingerprint(cookies)` —
 * válido enquanto os cookies não mudarem; 401/403 invalida a entrada e
 * a reimportação de cookies gera outra chave (sem token obsoleto).
 *
 * A lógica PURA (constantes, headers, parsing, classificação, formatação
 * de erros, fingerprint/chave do cache) vive em `ml-linkbuilder-pure.ts`.
 * Este arquivo mantém SOMENTE a camada de I/O (fetch + cache em memória).
 */

import {
  type CreateLinkResponse,
  type ShortLinkResult,
  buildCreateLinkApiHeaders,
  buildCreateLinkBody,
  buildCsrfCacheKey,
  buildLinkBuilderPageHeaders,
  CSRF_NOT_FOUND_MESSAGE,
  extractCsrfToken,
  formatCsrfRetrievalError,
  formatLinkBuilderHttpError,
  formatRenewalFailedError,
  isSessionExpiredStatus,
  ML_CREATE_LINK_API,
  ML_LINK_BUILDER_URL,
  parseCreateLinkResponse,
} from './ml-linkbuilder-pure.ts';
import { buildRefreshCookiesHeaders, mergeCookies } from './mercadolivre-pure.ts';

// ─── Cache de CSRF por afiliado (em memória) ────────────────────────────

/** Limite de entradas do cache (evita crescimento sem bound com muitos afiliados). */
const CSRF_CACHE_MAX_ENTRIES = 64;

/** token CSRF por `tag|fingerprint(cookies)` — Map preserva ordem de inserção. */
const csrfCache = new Map<string, string>();

function getCachedCsrfToken(tag: string, cookies: string): string | null {
  return csrfCache.get(buildCsrfCacheKey(tag, cookies)) ?? null;
}

function setCachedCsrfToken(tag: string, cookies: string, token: string): void {
  const key = buildCsrfCacheKey(tag, cookies);
  // Re-insere para atualizar a ordem (eviction LRU aproximado).
  csrfCache.delete(key);
  csrfCache.set(key, token);
  while (csrfCache.size > CSRF_CACHE_MAX_ENTRIES) {
    const oldest = csrfCache.keys().next().value;
    if (oldest === undefined) break;
    csrfCache.delete(oldest);
  }
}

function evictCachedCsrfToken(tag: string, cookies: string): void {
  csrfCache.delete(buildCsrfCacheKey(tag, cookies));
}

/** Reseta o cache de CSRF (apenas testes unitários). */
export function _testResetCsrfCache(): void {
  csrfCache.clear();
}

// ─── Renovação de cookies de sessão ─────────────────────────────────────

export interface SessionRenewalResult {
  /** Cookies após a mescla com os set-cookie recebidos (ou os atuais). */
  cookies: string;
  /** true quando o servidor enviou ao menos um set-cookie (sessão renovada). */
  renewed: boolean;
}

/**
 * Extrai todos os headers `set-cookie` da resposta.
 * Usa `getSetCookie()` quando disponível (Bun/Node 20+) e cai para
 * `get('set-cookie')` em mocks/ambientes sem suporte.
 */
function extractSetCookieHeaders(headers: Headers | undefined): string[] {
  if (!headers) return [];
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    try {
      const values = getSetCookie.call(headers);
      if (values.length > 0) return values;
    } catch {
      // fallback abaixo
    }
  }
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

/**
 * Renova cookies de sessão fazendo GET no Link Builder (www.mercadolivre.com.br)
 * com os cookies atuais e capturando os headers `set-cookie`.
 *
 * - Sem cookies atuais → `{ cookies: '', renewed: false }`
 * - Sem set-cookie na resposta → cookies atuais, `renewed: false`
 * - Com set-cookie → mescla via `mergeCookies()` e marca `renewed: true`
 * - Fetch falhou → cookies atuais, `renewed: false` (nunca lança)
 */
export async function renewSessionCookies(
  currentCookies: string | undefined,
): Promise<SessionRenewalResult> {
  if (!currentCookies) return { cookies: '', renewed: false };

  try {
    const res = await fetch(ML_LINK_BUILDER_URL, {
      headers: buildRefreshCookiesHeaders(currentCookies),
      redirect: 'manual',
    });

    const setCookies = extractSetCookieHeaders(res.headers);
    if (setCookies.length === 0) {
      return { cookies: currentCookies, renewed: false };
    }

    return {
      cookies: mergeCookies(currentCookies, setCookies.join(', ')),
      renewed: true,
    };
  } catch {
    return { cookies: currentCookies, renewed: false };
  }
}

// ─── Obtenção de CSRF (cache-first, com renovação) ──────────────────────

type CsrfStepResult =
  { ok: true; csrf: string; cookies: string } | { ok: false; error: string; cookies: string };

/**
 * Obtém o token CSRF para `tag` + `cookies`, consultando o cache antes do GET.
 * Em falha de sessão (401/403 na página ou ausência do <meta> — página de
 * login), tenta renovar os cookies UMA vez e repete o GET; se a renovação
 * não produzir cookies novos, devolve o erro original.
 */
async function obtainCsrfToken(tag: string, cookies: string): Promise<CsrfStepResult> {
  const cached = getCachedCsrfToken(tag, cookies);
  if (cached) return { ok: true, csrf: cached, cookies };

  try {
    let pageRes = await fetch(ML_LINK_BUILDER_URL, {
      headers: buildLinkBuilderPageHeaders(cookies),
    });

    // 401/403 na página → cookies expirados: tenta renovar e repetir o GET.
    if (isSessionExpiredStatus(pageRes.status)) {
      const renewal = await renewSessionCookies(cookies);
      if (!renewal.renewed) {
        return { ok: false, error: formatLinkBuilderHttpError('page', pageRes.status), cookies };
      }
      evictCachedCsrfToken(tag, cookies);
      cookies = renewal.cookies;
      pageRes = await fetch(ML_LINK_BUILDER_URL, {
        headers: buildLinkBuilderPageHeaders(cookies),
      });
    }

    if (!pageRes.ok) {
      return { ok: false, error: formatLinkBuilderHttpError('page', pageRes.status), cookies };
    }

    const html = await pageRes.text();
    const token = extractCsrfToken(html);

    if (!token) {
      // Sem <meta csrf-token> → provável página de login (cookies expirados):
      // tenta renovar uma vez e repetir o GET antes de desistir.
      const renewal = await renewSessionCookies(cookies);
      if (renewal.renewed) {
        evictCachedCsrfToken(tag, cookies);
        cookies = renewal.cookies;
        const retryRes = await fetch(ML_LINK_BUILDER_URL, {
          headers: buildLinkBuilderPageHeaders(cookies),
        });
        if (retryRes.ok) {
          const retryToken = extractCsrfToken(await retryRes.text());
          if (retryToken) {
            setCachedCsrfToken(tag, cookies, retryToken);
            return { ok: true, csrf: retryToken, cookies };
          }
        }
      }
      return { ok: false, error: CSRF_NOT_FOUND_MESSAGE, cookies };
    }

    setCachedCsrfToken(tag, cookies, token);
    return { ok: true, csrf: token, cookies };
  } catch (err) {
    return { ok: false, error: formatCsrfRetrievalError(err), cookies };
  }
}

// ─── Função principal ───────────────────────────────────────────────────

/**
 * Gera um link curto (meli.la) usando a API interna do Link Builder do ML.
 *
 * @param productUrl - URL do produto no Mercado Livre
 * @param tag - Etiqueta de afiliado (ex: "mtorreao", "om895584")
 * @param sessionCookies - Cookies de sessão completos (incluindo HttpOnly)
 * @returns ShortLinkResult com short_url, erro e/ou renewedCookies
 *
 * Fluxo:
 * 1. CSRF token: cache por afiliado (tag + fingerprint dos cookies) ou
 *    GET na página do Link Builder → extrai do <meta> (1 request no hit)
 * 2. POST no endpoint createLink com cookies + CSRF + body
 * 3. 401/403 no POST → renovação automática via set-cookie → refaz 1+2
 * 4. Renovação sem novos cookies ou 2º 401/403 → erro de cookie expirado
 *    (chamador cai no fallback de URL params)
 */
export async function generateShortAffiliateLink(
  productUrl: string,
  tag: string,
  sessionCookies: string,
): Promise<ShortLinkResult> {
  let cookies = sessionCookies;

  try {
    // ── 1. CSRF token (cache ou GET na página) ──
    const csrfStep = await obtainCsrfToken(tag, cookies);
    if (!csrfStep.ok) {
      return { success: false, error: csrfStep.error };
    }
    cookies = csrfStep.cookies;

    // ── 2. Chamar API createLink ──
    const body = buildCreateLinkBody(productUrl, tag);

    let apiRes = await fetch(ML_CREATE_LINK_API, {
      method: 'POST',
      headers: buildCreateLinkApiHeaders(cookies, csrfStep.csrf),
      body: JSON.stringify(body),
    });

    // ── 3. 401/403 → cookies expirados: renovar e tentar UMA vez ──
    if (isSessionExpiredStatus(apiRes.status)) {
      evictCachedCsrfToken(tag, cookies);

      const renewal = await renewSessionCookies(cookies);
      if (!renewal.renewed) {
        return {
          success: false,
          error: formatRenewalFailedError(apiRes.status),
        };
      }
      cookies = renewal.cookies;
      evictCachedCsrfToken(tag, cookies); // CSRF de cookies antigos não serve pros novos

      const csrfRetry = await obtainCsrfToken(tag, cookies);
      if (!csrfRetry.ok) {
        return { success: false, error: csrfRetry.error };
      }
      cookies = csrfRetry.cookies;

      apiRes = await fetch(ML_CREATE_LINK_API, {
        method: 'POST',
        headers: buildCreateLinkApiHeaders(cookies, csrfRetry.csrf),
        body: JSON.stringify(body),
      });

      if (isSessionExpiredStatus(apiRes.status)) {
        return {
          success: false,
          error: formatRenewalFailedError(apiRes.status),
        };
      }
    }

    if (!apiRes.ok) {
      return {
        success: false,
        error: formatLinkBuilderHttpError('api', apiRes.status),
      };
    }

    const data = (await apiRes.json()) as CreateLinkResponse;

    // ── 4. Validar resposta ──
    const result = parseCreateLinkResponse(data);
    if (result.success && cookies !== sessionCookies) {
      result.renewedCookies = cookies;
    }
    return result;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
