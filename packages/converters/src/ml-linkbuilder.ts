/**
 * @omestre/converters — Geração programática de links curtos ML (meli.la)
 * =============================================================================
 * Usa a API interna do Link Builder do Mercado Livre, descoberta via
 * inspeção de rede (Playwright) no painel de afiliados.
 *
 * Requer cookies de sessão do ML (não OAuth Bearer token).
 */

export const ML_LINK_BUILDER_URL =
  'https://www.mercadolivre.com.br/afiliados/linkbuilder';

export const ML_CREATE_LINK_API =
  'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';

const CSRF_REGEX = /<meta\s+name="csrf-token"\s+content="([^"]+)"/i;

// ─── Interfaces ────────────────────────────────────────────────────────────

interface CreateLinkResponse {
  status: number;
  urls?: Array<{
    id?: string;
    short_url?: string;
    long_url?: string;
    tag?: string;
    type_url?: string;
    message?: string;
    error_code?: number;
    status?: number;
  }>;
  total_items?: number;
  total_success?: number;
  total_error?: number;
}

export interface ShortLinkResult {
  success: boolean;
  shortUrl?: string;
  longUrl?: string;
  error?: string;
}

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
        headers: {
          Cookie: sessionCookies,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        },
      });

      if (!pageRes.ok) {
        return {
          success: false,
          error: `Falha ao acessar Link Builder: HTTP ${pageRes.status}`,
        };
      }

      const html = await pageRes.text();
      const match = html.match(CSRF_REGEX);

      if (!match?.[1]) {
        return {
          success: false,
          error: 'CSRF token não encontrado na página. Cookies podem estar expirados.',
        };
      }

      csrfToken = match[1];
    } catch (err) {
      return {
        success: false,
        error: `Erro ao obter CSRF token: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // ── 2. Chamar API createLink ──
    const body: CreateLinkRequest = {
      urls: [productUrl],
      tag,
    };

    const apiRes = await fetch(ML_CREATE_LINK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: sessionCookies,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        Referer: ML_LINK_BUILDER_URL,
        Origin: 'https://www.mercadolivre.com.br',
      },
      body: JSON.stringify(body),
    });

    if (!apiRes.ok) {
      return {
        success: false,
        error: `API do Link Builder retornou HTTP ${apiRes.status}`,
      };
    }

    const data = (await apiRes.json()) as CreateLinkResponse;

    // ── 3. Validar resposta ──
    if (!data.urls || data.urls.length === 0) {
      return {
        success: false,
        error: 'API retornou sem URLs',
      };
    }

    const result = data.urls[0]!;

    // Verificar erro interno (ex: tag inválida)
    if (result.error_code) {
      return {
        success: false,
        error: result.message || `Erro do Link Builder: código ${result.error_code}`,
      };
    }

    if (!result.short_url) {
      return {
        success: false,
        error: 'API não retornou short_url. Produto pode não ser elegível.',
      };
    }

    return {
      success: true,
      shortUrl: result.short_url,
      longUrl: result.long_url,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

interface CreateLinkRequest {
  urls: string[];
  tag: string;
}
