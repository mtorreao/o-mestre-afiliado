/**
 * Lógica pura de sessão — decisões de expiração/renovação de tokens.
 * Sem I/O (sem localStorage, sem fetch), para cobertura 100%.
 */

export interface SessionTokenSet {
  accessToken: string | null;
  refreshToken: string | null;
}

export const DEFAULT_SKEW_SECONDS = 60; // renova até 60s antes de expirar

/** Decodifica o campo `exp` (segundos Unix) de um JWT. Null se inválido. */
export function decodeJwtExp(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]!));
    const exp = (payload as Record<string, unknown>).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** Converte um JWT payload (base64url) para string. */
export function base64UrlDecode(segment: string): string {
  const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64').toString('utf-8');
}

/** Segundos restantes até a expiração (mm:ss). */
export function secondsUntilExpiry(token: string, nowMs: number = Date.now()): number {
  const exp = decodeJwtExp(token);
  if (exp === null) return 0;
  return exp - Math.floor(nowMs / 1000);
}

/** True se o access token está dentro da janela de renovação proativa. */
export function shouldProactivelyRefresh(
  token: string | null | undefined,
  nowMs: number = Date.now(),
  skewSeconds: number = DEFAULT_SKEW_SECONDS,
): boolean {
  if (!token) return false;
  const seconds = secondsUntilExpiry(token, nowMs);
  return seconds <= skewSeconds;
}

/** True se o token de acesso já expirou (não renovável). */
export function isAccessExpired(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!token) return true;
  return secondsUntilExpiry(token, nowMs) <= 0;
}
