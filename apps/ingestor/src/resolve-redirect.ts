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
 */

const PROMOZONE_RESOLVE_API = 'https://link-shortener-501307668672.southamerica-east1.run.app';
const PROMOZONE_RESOLVE_PATH = '/resolve';

const REDIRECTOR_DOMAINS = [
  {
    pattern: /go\.promozone\.ai/i,
    resolve: resolvePromozone,
  },
  {
    pattern: /s\.shopee\.com\.br/i,
    resolve: resolveShopeeShortlink,
  },
] as const;

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

export async function resolveRedirectUrl(url: string): Promise<string> {
  for (const redirector of REDIRECTOR_DOMAINS) {
    if (redirector.pattern.test(url)) {
      const resolved = await redirector.resolve(url);
      if (resolved && resolved !== url) return resolved;
      break;
    }
  }
  return url;
}

export function isRedirectorUrl(url: string): boolean {
  return REDIRECTOR_DOMAINS.some((r) => r.pattern.test(url));
}