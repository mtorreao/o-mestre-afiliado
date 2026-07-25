/**
 * resolve-redirect.ts — Resolve URLs de redirectors para a URL de destino real.
 *
 * Extraído de apps/worker/src/resolve-redirect.ts para apps/ingestor/src/resolve-redirect.ts.
 * Apenas o Ingestor precisa resolver redirects (Dispatcher só envia).
 *
 * Tipos suportados:
 *   - go.promozone.ai → API link-shortener-501307668672 (redirectors de afiliado)
 *   - s.shopee.com.br → Location header (redirectors da Shopee — pode ser
 *     página de produto, cupom, voucher, ou afiliado)
 *   - meli.la → Location header (shortlink oficial do Mercado Livre).
 *     Crítico: muitos meli.la escondem PERFIS SOCIAIS / LISTAS de outros
 *     afiliados (ex: /social/om895584) — esses NÃO são produtos elegíveis
 *     e devem ser descartados antes de chamar o Link Builder.
 */

const PROMOZONE_RESOLVE_API = 'https://link-shortener-501307668672.southamerica-east1.run.app';
const PROMOZONE_RESOLVE_PATH = '/resolve';

// Parâmetros de tracking injetados por afiliado que devem ser REMOVIDOS da
// URL após o redirect, pois fazem o Link Builder do ML rejeitar a URL
// (erro 111 — "URL not allowed in affiliates program") com a comissão
// atribuída a outro afiliado.
const ML_TRACKING_PARAMS_TO_STRIP = [
  'matt_word',
  'matt_tool',
  'matt_event_ts',
  'matt_d2id',
  'matt_tracing_id',
  'forceInApp',
  'ref',
  'tracking_id',
  'polycard_client',
  'reco_backend',
  'reco_client',
  'reco_backend_type',
  'reco_id',
  'reco_item_pos',
  'wid',
  'sid',
  'c_id',
  'c_uid',
  'source',
  'device',
  'domain',
  'sub_path',
];

function stripMeliTrackingParams(url: string): { url: string; dropped: string[] } {
  const dropped: string[] = [];
  try {
    const u = new URL(url);
    for (const p of ML_TRACKING_PARAMS_TO_STRIP) {
      if (u.searchParams.has(p)) {
        dropped.push(p);
        u.searchParams.delete(p);
      }
    }
    // Remove fragment hashtag com params de tracking
    if (u.hash) {
      u.hash = '';
    }
    return { url: u.toString(), dropped };
  } catch {
    return { url, dropped };
  }
}

/**
 * Detecta se a URL do Mercado Livre é uma página de PRODUTO.
 * URLs válidas: /p/MLB<id> ou /<slug>/p/MLB<id>.
 * Rejeitadas: /social/<id>, /sec/<id>, /coupons/<id>, /up/<id>, etc.
 */
export function isMeliProductUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/mercadolivre\.com\.br/i.test(u.hostname)) return false;
    const m = u.pathname.match(/\/p\/MLB\d+/i);
    return !!m;
  } catch {
    return false;
  }
}

/**
 * Resultado de um resolve de shortlink de Mercado Livre:
 *   - url: URL canônica (sem params de tracking), ou string original se não
 *     foi possível resolver
 *   - isProduct: true se a URL final é uma página de produto
 *   - reason: motivo de bloqueio (isProduct=false), útil para log
 *   - droppedParams: lista de params removidos (para log/debug)
 */
export interface ResolvedMeliRedirect {
  url: string;
  isProduct: boolean;
  reason?: string;
  droppedParams?: string[];
}

type Resolver = (url: string) => Promise<string | null> | Promise<ResolvedMeliRedirect | null>;
const REDIRECTOR_DOMAINS: { pattern: RegExp; resolve: Resolver }[] = [
  {
    pattern: /go\.promozone\.ai/i,
    resolve: resolvePromozone,
  },
  {
    pattern: /s\.shopee\.com\.br/i,
    resolve: resolveShopeeShortlink,
  },
  {
    pattern: /meli\.la/i,
    resolve: resolveMeliShortlink,
  },
];

function extractShortCode(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? null;
  } catch {
    return null;
  }
}

async function resolvePromozone(url: string): Promise<string | null> {
  const shortCode = extractShortCode(url);
  if (!shortCode) return null;
  if (!/^[0-9A-Za-z]{6,8}$/.test(shortCode)) return null;

  try {
    const resolveUrl = `${PROMOZONE_RESOLVE_API}${PROMOZONE_RESOLVE_PATH}/${encodeURIComponent(shortCode)}`;
    const res = await fetch(resolveUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) return null;
    const data = await res.json() as { destinationUrl?: string };
    if (!data.destinationUrl) return null;

    try {
      const destUrl = new URL(data.destinationUrl);
      if (destUrl.protocol !== 'http:' && destUrl.protocol !== 'https:') return null;
    } catch {
      return null;
    }
    return data.destinationUrl;
  } catch {
    return null;
  }
}

/**
 * Resolve um shortlink s.shopee.com.br/{code} para a URL de destino real.
 *
 * Faz um HEAD request com `redirect: 'manual'` para extrair o Location header
 * sem baixar o HTML (Shopee é 100% client-side rendered, então o HEAD é
 * suficiente — não precisamos do body para descobrir o destino).
 *
 * Retorna:
 *   - null se não foi possível resolver (erro, sem Location, link afiliado/cupom)
 *   - URL final se for uma página de produto (contém /-i.ShopId.ItemId)
 */
async function resolveShopeeShortlink(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(5_000),
    });

    // 30x → extrai Location. 200 (já resolvido) → usa URL original.
    const location = res.headers.get('location');
    const finalUrl = location ?? (res.status === 200 ? url : null);
    if (!finalUrl) return null;

    // Se a URL final NÃO é da Shopee (página externa, deep-link), descarta.
    let parsed: URL;
    try {
      parsed = new URL(finalUrl);
    } catch {
      return null;
    }
    if (!/shopee\.com\.br/i.test(parsed.hostname)) return null;

    // Se a URL aponta para cupom/afiliado/voucher/wallet, descarta — não é
    // um produto. Esses links não devem ser usados como originalLink para
    // dedup nem para extração de imagem.
    const isProductPage = /-i\.\d+\.\d+/i.test(parsed.pathname);
    const isLandingPage =
      /^\/user\//i.test(parsed.pathname) ||
      /utm_/i.test(parsed.search) ||
      /voucher-wallet/i.test(parsed.pathname);

    if (!isProductPage || isLandingPage) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Resolve um shortlink meli.la/{code} para a URL de destino real.
 *
 * Estratégia:
 * 1. GET com `redirect: 'manual'` → extrai Location header (1 hop)
 * 2. Strip de params de tracking (`matt_word`, `matt_tool`, `ref`, etc.)
 *    que foram injetados pelo afiliado original
 * 3. Detecta se a URL final é de PRODUTO (/p/MLB<id>) ou NÃO
 *    (perfis sociais, listas, cupons, etc.)
 *
 * Retorna `ResolvedMeliRedirect` com:
 *   - url: URL canônica (sem params de tracking)
 *   - isProduct: true se é página de produto, false caso contrário
 *   - reason: motivo de não-produto (ex: "social_profile", "social_lists")
 *   - droppedParams: lista de params removidos
 *
 * Se não conseguir resolver (erro de rede, sem Location), marca
 * isProduct=false com reason="redirect_failed" — o caller deve BLOQUEAR
 * a oferta (não enviar URL com shortlink não-resolvido pro Link Builder).
 */
async function resolveMeliShortlink(url: string): Promise<ResolvedMeliRedirect | null> {
  let finalUrl: string | null = null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(5_000),
    });

    // 30x → Location header. 200 → URL já resolvida.
    const location = res.headers.get('location');
    if (location) {
      finalUrl = location;
    } else if (res.status === 200) {
      finalUrl = url;
    }
  } catch {
    return { url, isProduct: false, reason: 'redirect_failed' };
  }

  if (!finalUrl) {
    return { url, isProduct: false, reason: 'no_location_header' };
  }

  // Resolve Location relativo (ex: /social/om895584?x=1) para absoluto
  let absoluteUrl: string;
  try {
    absoluteUrl = new URL(finalUrl, url).toString();
  } catch {
    return { url, isProduct: false, reason: 'invalid_location_url' };
  }

  // Aceita somente destinos no domínio do Mercado Livre
  let parsed: URL;
  try {
    parsed = new URL(absoluteUrl);
  } catch {
    return { url: absoluteUrl, isProduct: false, reason: 'invalid_url' };
  }

  if (!/mercadolivre\.com\.br/i.test(parsed.hostname)) {
    return { url: absoluteUrl, isProduct: false, reason: 'external_domain' };
  }

  // Strip params de tracking injetados por outro afiliado
  const { url: cleanUrl, dropped } = stripMeliTrackingParams(absoluteUrl);
  const isProduct = isMeliProductUrl(cleanUrl);

  let reason: string | undefined;
  if (!isProduct) {
    // Diagnosticar o tipo de URL para log
    if (/^\/social\//i.test(parsed.pathname)) {
      reason = 'social_profile';
    } else if (/^\/sec\//i.test(parsed.pathname)) {
      reason = 'category_listing';
    } else if (/^\/coupons?\//i.test(parsed.pathname)) {
      reason = 'coupon';
    } else if (/^\/up\//i.test(parsed.pathname)) {
      reason = 'upsell';
    } else {
      reason = 'not_product_url';
    }
  }

  const result: ResolvedMeliRedirect = { url: cleanUrl, isProduct };
  if (reason) result.reason = reason;
  if (dropped.length > 0) result.droppedParams = dropped;
  return result;
}

export async function resolveRedirectUrl(url: string): Promise<string> {
  for (const redirector of REDIRECTOR_DOMAINS) {
    if (redirector.pattern.test(url)) {
      const resolved = await redirector.resolve(url);
      // Resolvers podem retornar string ou ResolvedMeliRedirect.
      // Normaliza para string (URL canônica ou URL original).
      const resolvedUrl =
        typeof resolved === 'string' ? resolved : resolved?.url;
      if (resolvedUrl && resolvedUrl !== url) return resolvedUrl;
      break;
    }
  }
  return url;
}

/**
 * Resolve um shortlink de Mercado Livre (meli.la) com análise completa.
 * Retorna o result tipo ResolvedMeliRedirect (URL canônica + isProduct + reason).
 *
 * Se a URL não é um meli.la, retorna a URL original com isProduct=true
 * (assume produto — caller que decide).
 */
export async function resolveMeliRedirect(url: string): Promise<ResolvedMeliRedirect> {
  if (!/meli\.la/i.test(url)) {
    return { url, isProduct: true };
  }
  const result = await resolveMeliShortlink(url);
  if (!result) {
    return { url, isProduct: false, reason: 'redirect_failed' };
  }
  return result;
}

export function isRedirectorUrl(url: string): boolean {
  return REDIRECTOR_DOMAINS.some((r) => r.pattern.test(url));
}
