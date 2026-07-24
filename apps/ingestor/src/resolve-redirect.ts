/**
 * Resolve URLs de redirectors JS (go.promozone.ai) para a URL de destino real.
 *
 * Extraído de apps/worker/src/resolve-redirect.ts para apps/ingestor/src/resolve-redirect.ts.
 * Apenas o Ingestor precisa resolver redirects (Dispatcher só envia).
 */

const PROMOZONE_RESOLVE_API = 'https://link-shortener-501307668672.southamerica-east1.run.app';
const PROMOZONE_RESOLVE_PATH = '/resolve';

const REDIRECTOR_DOMAINS = [
  {
    pattern: /go\.promozone\.ai/i,
    resolve: resolvePromozone,
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