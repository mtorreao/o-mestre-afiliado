/**
 * Gerenciador de sessão no frontend.
 *
 * Guarda access token + refresh token em localStorage e expõe operações:
 * - setSession(access, refresh)
 * - clearSession()
 * - Proactive refresh scheduling (renovação deslizante)
 */
import { shouldProactivelyRefresh, isAccessExpired } from './auth-session-pure.ts';
import type { SessionTokenSet } from './auth-session-pure.ts';

export const ACCESS_STORAGE_KEY = 'omestre_auth_token';
export const REFRESH_STORAGE_KEY = 'omestre_refresh_token';

export interface Session extends SessionTokenSet {
  /** true se a sessão está ativa (possui tokens). */
  active: boolean;
}

const listeners = new Set<() => void>();

function readAccess(): string | null {
  try {
    return localStorage.getItem(ACCESS_STORAGE_KEY);
  } catch {
    return null;
  }
}

function readRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

export function getSession(): Session {
  const accessToken = readAccess();
  const refreshToken = readRefresh();
  return {
    accessToken,
    refreshToken,
    active: !!accessToken && !!refreshToken,
  };
}

export function getAccessToken(): string | null {
  return readAccess();
}

export function getRefreshToken(): string | null {
  return readRefresh();
}

export function setSession(accessToken: string, refreshToken: string): void {
  try {
    localStorage.setItem(ACCESS_STORAGE_KEY, accessToken);
    localStorage.setItem(REFRESH_STORAGE_KEY, refreshToken);
  } catch {
    /* ignore quota */
  }
  notify();
}

export function clearSession(): void {
  try {
    localStorage.removeItem(ACCESS_STORAGE_KEY);
    localStorage.removeItem(REFRESH_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notify();
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

/** Promise compartilhada para evitar refresh concorrente (single-flight). */
let refreshInFlight: Promise<RefreshResult> | null = null;

/**
 * Renova o par de tokens chamando POST /api/auth/refresh.
 * Usa single-flight: chamadas concorrentes reutilizam a mesma requisição.
 */
export async function refreshTokens(): Promise<RefreshResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('Sem refresh token');

  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = (await res.json()) as {
      success: boolean;
      token?: string;
      refreshToken?: string;
      error?: string;
    };
    if (!res.ok || !data.success || !data.token || !data.refreshToken) {
      throw new Error(data.error || 'Falha ao renovar sessão');
    }
    setSession(data.token, data.refreshToken);
    return { accessToken: data.token, refreshToken: data.refreshToken };
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/**
 * Renovação proativa (deslizante): se o access token estiver na janela
 * de expiração, renova antes de vencer. Retorna true se renovou.
 */
export async function proactivelyRefreshNow(): Promise<boolean> {
  const access = getAccessToken();
  if (shouldProactivelyRefresh(access)) {
    try {
      await refreshTokens();
      return true;
    } catch {
      // sessão expirada de vez → será tratada no 401 do próximo request
      return false;
    }
  }
  return false;
}

export async function logoutSession(): Promise<void> {
  const refreshToken = getRefreshToken();
  clearSession();
  if (refreshToken) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
}

export { isAccessExpired, getAccessToken as _getAccess };
