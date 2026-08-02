/**
 * Rate limiter para rotas de autenticação (login/register).
 *
 * Estratégia: por IP, com janela deslizante.
 * Sem dependência de Redis para manter o serviço leve e testável.
 *
 * Limites:
 *   - LOGIN: 5 tentativas por minuto por IP
 *   - REGISTER: 3 registros por hora por IP
 */

export const LOGIN_MAX_REQUESTS = 5;
export const LOGIN_WINDOW_MS = 60_000; // 1 minuto

export const REGISTER_MAX_REQUESTS = 3;
export const REGISTER_WINDOW_MS = 60 * 60_000; // 1 hora

export class RateLimitError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryAfterMs: number,
    message: string,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export interface RateLimiterOptions {
  maxRequests: number;
  windowMs: number;
}

export class IpRateLimiter {
  readonly hits = new Map<string, number[]>();

  constructor(private readonly opts: RateLimiterOptions) {}

  /**
   * Verifica se a request é permitida.
   * Lança RateLimitError se o IP excedeu o limite.
   */
  check(key: string, now: number = Date.now()): void {
    const { maxRequests, windowMs } = this.opts;
    const cutoff = now - windowMs;
    const recent = (this.hits.get(key) || []).filter((t) => t > cutoff);

    if (recent.length >= maxRequests) {
      const oldestHit = recent[0] ?? now;
      const retryAfterMs = windowMs - (now - oldestHit);
      this.hits.set(key, recent);
      throw new RateLimitError(
        'rate-limit-exceeded',
        Math.max(retryAfterMs, 0),
        `Limite de ${maxRequests} requests por ${windowMs / 1000}s excedido. Tente novamente em ${Math.ceil(retryAfterMs / 1000)}s.`,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);
  }

  /** Limpa entradas expiradas (evita unbounded growth). */
  prune(now: number = Date.now()): number {
    const { windowMs } = this.opts;
    const cutoff = now - windowMs;
    let removed = 0;
    for (const [k, times] of this.hits) {
      const recent = times.filter((t) => t > cutoff);
      if (recent.length === 0) {
        this.hits.delete(k);
        removed++;
      } else {
        this.hits.set(k, recent);
      }
    }
    return removed;
  }
}

/**
 * Extrai IP do cliente a partir dos headers do request.
 * Suporta X-Forwarded-For (se houver proxy reverso) e cai para 'unknown'.
 */
export function getClientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() ?? 'unknown';
  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}
