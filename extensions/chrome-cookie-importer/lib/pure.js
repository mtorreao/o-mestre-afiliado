export const ML_DOMAINS = ['.mercadolivre.com.br', '.mercadolibre.com', '.mercadolivre.com'];

export const MAGALU_DOMAINS = ['.magazinevoce.com.br'];

export const MAGALU_ONELINK_API =
  'https://www.magazinevoce.com.br/azion-rochelle-proxy/v1/shortenlink/onelink';

export const DEFAULT_API_URL = 'https://dev.omestreafiliado.com.br';

export function normalizeApiUrl(value) {
  const trimmed = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    if (url.username || url.password || url.search || url.hash) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function isMercadoLivreUrl(value) {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return ML_DOMAINS.some((domain) => hostname === domain.slice(1) || hostname.endsWith(domain));
  } catch {
    return false;
  }
}

export function deduplicateCookies(cookies) {
  const seen = new Map();
  for (const cookie of cookies) {
    if (!cookie?.name) continue;
    const key = `${cookie.name}:${cookie.path || '/'}`;
    seen.set(key, cookie);
  }
  return [...seen.values()];
}

export function serializeCookies(cookies) {
  return deduplicateCookies(cookies)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export function cookieMetadata(cookies) {
  const uniqueCookies = deduplicateCookies(cookies);
  return {
    count: uniqueCookies.length,
    domains: [...new Set(uniqueCookies.map((cookie) => cookie.domain).filter(Boolean))],
  };
}

export function redactSensitiveText(value) {
  return String(value || '')
    .replace(/(sessionCookies|cookie|authorization|token)\s*[:=]\s*[^,;\s}]+/gi, '$1=[redacted]')
    .replace(/\b[A-Za-z0-9_\-]{24,}\b/g, '[redacted]');
}
