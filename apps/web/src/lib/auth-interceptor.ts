/**
 * Interceptor global de fetch — mantém o usuário conectado.
 *
 * Em todo request para /api:
 *  1. Injeta o access token no header Authorization (se ausente).
 *  2. Renova proativamente o access token antes de expirar (deslizante).
 *  3. Em 401, tenta um refresh single-flight e refaz a requisição uma vez;
 *     se o refresh falhar, desloga e dispara omestre:auth-changed.
 */
import {
  getAccessToken,
  getRefreshToken,
  proactivelyRefreshNow,
  refreshTokens,
  clearSession,
} from './auth-session.ts';

// Endpoints de auth que não devem ser envelopados com Bearer nem retentados.
const AUTH_ENDPOINTS = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/refresh']);

let installed = false;

export function installAuthInterceptor(): void {
  if (installed) return;
  installed = true;

  const original = globalThis.fetch;

  const wrapped = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    // Fora de /api ou em endpoints de auth: repassa sem intervenção.
    if (!url.includes('/api/') || isAuthEndpoint(url)) {
      return original(input, init);
    }

    // Tentativa com renovação proativa primeiro.
    await proactivelyRefreshNow();

    const headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      const token = getAccessToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }

    const merged: RequestInit = { ...init, headers };

    let response = await original(url, merged);

    // 401: tenta renovar (single-flight) e refaz uma vez.
    if (response.status === 401 && getRefreshToken()) {
      try {
        await refreshTokens();
      } catch {
        // Refresh inválido/expirado → encerra a sessão.
        clearSession();
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('omestre:auth-changed'));
        }
        return response;
      }

      const token = getAccessToken();
      const retryHeaders = new Headers();
      if (token) retryHeaders.set('Authorization', `Bearer ${token}`);
      response = await original(url, { ...init, headers: retryHeaders });
    }

    return response;
  };

  globalThis.fetch = wrapped as typeof fetch;
}

function isAuthEndpoint(url: string): boolean {
  for (const ep of AUTH_ENDPOINTS) {
    if (url.includes(ep)) return true;
  }
  return false;
}
