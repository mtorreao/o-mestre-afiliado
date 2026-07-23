/**
 * Resolve URLs de redirectors JS (go.promozone.ai) para a URL de destino real.
 *
 * O Promozone usa um SPA com redirect via JavaScript. O código do bundle
 * revelou uma API interna (/resolve/{shortCode}) que retorna a URL real.
 * Esta função extrai o short code e chama essa API para obter o destino.
 */

// ─── Constantes extraídas do bundle JS do Promozone ────────────────
const PROMOZONE_RESOLVE_API = 'https://link-shortener-501307668672.southamerica-east1.run.app';
const PROMOZONE_RESOLVE_PATH = '/resolve';

// Domínios de redirectors JS conhecidos
const REDIRECTOR_DOMAINS = [
  {
    pattern: /go\.promozone\.ai/i,
    resolve: resolvePromozone,
  },
] as const;

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Extrai o short code (último segmento do path) de uma URL do Promozone.
 * Ex: "https://go.promozone.ai/shopee/E5VhS0" → "E5VhS0"
 */
function extractShortCode(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve um short code do Promozone via API interna.
 * Retorna a URL de destino ou null em caso de falha.
 */
async function resolvePromozone(url: string): Promise<string | null> {
  const shortCode = extractShortCode(url);
  if (!shortCode) return null;

  // Valida o formato do short code (6-8 caracteres alfanuméricos)
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

    // Valida que a URL de destino é HTTP/HTTPS
    try {
      const destUrl = new URL(data.destinationUrl);
      if (destUrl.protocol !== 'http:' && destUrl.protocol !== 'https:') return null;
    } catch {
      return null;
    }

    return data.destinationUrl;
  } catch {
    // Timeout ou erro de rede — fallback silencioso
    return null;
  }
}

// ─── API Pública ───────────────────────────────────────────────────

/**
 * Tenta resolver uma URL de redirector JS (ex: go.promozone.ai)
 * para a URL de destino real. Se a URL não for de um redirector
 * conhecido ou a resolução falhar, retorna a URL original.
 *
 * @param url — URL para tentar resolver
 * @returns URL resolvida ou URL original se não for resolvível
 */
export async function resolveRedirectUrl(url: string): Promise<string> {
  for (const redirector of REDIRECTOR_DOMAINS) {
    if (redirector.pattern.test(url)) {
      const resolved = await redirector.resolve(url);
      if (resolved && resolved !== url) {
        return resolved;
      }
      // Se falhou, retorna a original (quem chamou decide o que fazer)
      break;
    }
  }
  return url;
}

/**
 * Verifica se uma URL é de um redirector JS conhecido.
 */
export function isRedirectorUrl(url: string): boolean {
  return REDIRECTOR_DOMAINS.some((r) => r.pattern.test(url));
}
