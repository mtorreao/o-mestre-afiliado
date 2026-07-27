/**
 * @omestre/converters — Geração programática de links curtos ML (meli.la)
 * =============================================================================
 * Usa a API interna do Link Builder do Mercado Livre, descoberta via
 * inspeção de rede (Playwright) no painel de afiliados.
 *
 * Requer cookies de sessão do ML (não OAuth Bearer token).
 *
 * A lógica PURA (constantes, headers, parsing, classificação, formatação
 * de erros) vive em `ml-linkbuilder-pure.ts`. Este arquivo mantém SOMENTE
 * a camada de I/O (fetch). Nenhuma URL/header de auth foi alterada.
 */

import {
  type CreateLinkResponse,
  type ShortLinkResult,
  buildCreateLinkApiHeaders,
  buildCreateLinkBody,
  buildLinkBuilderPageHeaders,
  CSRF_NOT_FOUND_MESSAGE,
  extractCsrfToken,
  formatCsrfRetrievalError,
  formatLinkBuilderHttpError,
  ML_CREATE_LINK_API,
  ML_LINK_BUILDER_URL,
  parseCreateLinkResponse,
} from './ml-linkbuilder-pure.ts';

// ─── Função principal ───────────────────────────────────────────────────────

/**
 * Gera um link curto (meli.la) usando a API interna do Link Builder do ML.
 *
 * @param productUrl - URL do produto no Mercado Livre
 * @param tag - Etiqueta de afiliado (ex: "mtorreao", "om895584")
 * @param sessionCookies - Cookies de sessão completos (incluindo HttpOnly)
 * @returns ShortLinkResult com short_url ou erro
 *
 * Fluxo:
 * 1. GET na página do Link Builder → extrai CSRF token do <meta> tag
 * 2. POST no endpoint createLink com cookies + CSRF + body
 * 3. Retorna short_url (meli.la/xxx) ou erro
 */
export async function generateShortAffiliateLink(
  productUrl: string,
  tag: string,
  sessionCookies: string,
): Promise<ShortLinkResult> {
  try {
    // ── 1. Obter CSRF token da página do Link Builder ──
    let csrfToken: string;

    try {
      const pageRes = await fetch(ML_LINK_BUILDER_URL, {
        headers: buildLinkBuilderPageHeaders(sessionCookies),
      });

      if (!pageRes.ok) {
        return {
          success: false,
          error: formatLinkBuilderHttpError('page', pageRes.status),
        };
      }

      const html = await pageRes.text();
      const token = extractCsrfToken(html);

      if (!token) {
        return {
          success: false,
          error: CSRF_NOT_FOUND_MESSAGE,
        };
      }

      csrfToken = token;
    } catch (err) {
      return {
        success: false,
        error: formatCsrfRetrievalError(err),
      };
    }

    // ── 2. Chamar API createLink ──
    const body = buildCreateLinkBody(productUrl, tag);

    const apiRes = await fetch(ML_CREATE_LINK_API, {
      method: 'POST',
      headers: buildCreateLinkApiHeaders(sessionCookies, csrfToken),
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      return {
        success: false,
        error: formatLinkBuilderHttpError('api', apiRes.status),
      };
    }

    const data = (await apiRes.json()) as CreateLinkResponse;

    // ── 3. Validar resposta ──
    return parseCreateLinkResponse(data);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
