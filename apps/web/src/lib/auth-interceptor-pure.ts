/**
 * Lógica pura do interceptor de fetch — decisões de retry/injeção.
 * Sem I/O para cobertura 100%.
 */
export interface AuthCheckInput {
  status: number;
  hasRefreshToken: boolean;
  url: string;
}

export interface AuthDecision {
  /** Deve tentar refresh (401 + temos refresh token). */
  shouldRefresh: boolean;
  /** Este endpoint não deve ser envolto com Bearer nem retentado. */
  isAuthEndpoint: boolean;
}

const AUTH_ENDPOINTS = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh'];

export function isAuthEndpoint(url: string): boolean {
  return AUTH_ENDPOINTS.some((ep) => url.includes(ep));
}

export function decideRefresh({ status, hasRefreshToken, url }: AuthCheckInput): AuthDecision {
  return {
    shouldRefresh: status === 401 && hasRefreshToken && !isAuthEndpoint(url),
    isAuthEndpoint: isAuthEndpoint(url),
  };
}
