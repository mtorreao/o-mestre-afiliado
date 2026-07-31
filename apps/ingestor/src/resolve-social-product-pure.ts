/**
 * resolve-social-product-pure.ts — Lógica PURA (sem I/O) da resolução de
 * páginas /social/ do Mercado Livre.
 *
 * Extraída de resolve-social-product.ts para permitir 100% de cobertura via
 * testes unitários, sem rede/browser. A camada de I/O (fetch, Playwright)
 * vive em `resolve-social-product.ts`, que importa e delega para este módulo.
 *
 * IMPORTANTE: NÃO importar de `resolve-social-product.ts` aqui (circular).
 */

export interface SocialProductResolution {
  productUrl: string;
  imageUrl: string | null;
}

/** Regex do href de produto clássico do ML (/p/MLB<id>) num HTML. */
export const ML_PRODUCT_HREF_RE =
  /href="(https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^"]*\/p\/MLB\d+[^"]*)"/i;

/**
 * Extrai og:image/twitter:image de um HTML, tolerante à ordem de atributos.
 *
 * Quando há mais de um meta tag candidato (og:image E twitter:image),
 * devolve o primeiro cuja URL não seja template literal (`{slug}` etc.)
 * — não descarta um valor real só porque o primeiro candidato veio com
 * placeholder.
 */
export function extractOgImage(html: string): string | null {
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*?content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["'](?:og:image|twitter:image)["']/gi,
  ];

  type Candidate = { value: string; offset: number };
  const candidates: Candidate[] = [];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      if (m.index === undefined || !m[1]) continue;
      candidates.push({ value: m[1].trim(), offset: m.index });
    }
  }
  candidates.sort((a, b) => a.offset - b.offset);

  for (const { value } of candidates) {
    // Rejeita URLs com placeholders de template (ex.: {sanitized_title})
    // que o site não renderiza server-side — não são URLs baixáveis.
    // Mercado Livre devolve og:image com esse padrão em URLs do tipo
    // `D_Q_NP_*-{sanitized_title}.webp`. URL-template é inutilizável
    // pelo sendMedia do WhatsApp (404) e envenena o cache com `imageUrl`
    // não-funcional.
    if (/\{[^}]+\}/.test(value)) continue;
    return value;
  }

  return null;
}

/**
 * Normaliza uma URL de produto: remove query string e hash (params de
 * tracking do afiliado original). Retorna a string original se inválida.
 */
export function stripUrlParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/** URL final de navegação é uma página clássica de produto (/p/MLB<id>)? */
export function isMlProductPageUrl(url: string): boolean {
  return /\/p\/MLB\d+/i.test(url);
}

/**
 * Extrai (e normaliza) a primeira URL de produto /p/MLB<id> de um HTML.
 * Retorna null se não houver href de produto.
 */
export function extractMlProductHref(html: string): string | null {
  const match = html.match(ML_PRODUCT_HREF_RE);
  if (!match?.[1]) return null;
  return stripUrlParams(match[1]);
}

/**
 * Fallback: extrai a URL do link "Ir para (o) Produto" de um HTML,
 * aceitando apenas hosts mercadolivre.com.br. Retorna null caso contrário.
 */
export function extractIrParaProdutoHref(html: string): string | null {
  const irParaMatch = html.match(
    /<a[^>]+href="(https?:\/\/[^\"]+)"[^>]*>[^<]*Ir\s+para[^<]*<\/a>/i,
  );
  if (!irParaMatch?.[1]) return null;
  try {
    const url = new URL(irParaMatch[1]);
    if (!/mercadolivre\.com\.br/i.test(url.hostname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

/** Extrai URL do produto e imagem do mesmo HTML /social/. */
export function extractSocialProductDataFromHtml(html: string): SocialProductResolution | null {
  const productUrl = extractMlProductHref(html) ?? extractIrParaProdutoHref(html);
  if (!productUrl) return null;

  return {
    productUrl,
    imageUrl: extractOgImage(html),
  };
}

/**
 * Monta uma resolução a partir de uma URL final de navegação (browser).
 * Retorna null se a URL não é página de produto /p/MLB<id>.
 */
export function buildResolutionFromFinalUrl(
  finalUrl: string | null | undefined,
  imageUrl: string | null,
): SocialProductResolution | null {
  if (!finalUrl || !isMlProductPageUrl(finalUrl)) return null;
  return { productUrl: stripUrlParams(finalUrl), imageUrl };
}

/** Normaliza o content de uma meta tag vindo do browser (trim, ''→null). */
export function normalizeBrowserImageContent(content: string | null | undefined): string | null {
  return content?.trim() || null;
}
