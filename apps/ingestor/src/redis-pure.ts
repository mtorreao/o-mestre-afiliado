/**
 * Lógica PURA do client Redis do Ingestor.
 *
 * Separa o cálculo do backoff de retry (função passada ao ioredis como
 * `retryStrategy`) da construção do client (que depende de I/O/network).
 * A função aqui é síncrona, determinística e 100% testável sem conexão.
 */

/** Teto máximo (ms) do backoff de retry do Redis. */
export const REDIS_RETRY_MAX_MS = 5000;

/** Incremento base (ms) por tentativa: `times * 200`. */
export const REDIS_RETRY_BASE_MS = 200;

/**
 * Calcula o delay (ms) antes da próxima tentativa de reconexão do Redis.
 *
 * Estratégia: `min(times * 200, 5000)` — backoff linear com teto em 5s.
 * O ioredis passa `times` começando em 1 para a primeira reconexão.
 *
 * Nota de design: diferentemente de `product-image.ts`, aqui NÃO retornamos
 * `null` após N tentativas — o Ingestor precisa manter tentando reconectar
 * ao Redis (fail-open no caller, que trata `getRedis() === null`).
 */
export function redisRetryDelay(times: number): number {
  return Math.min(times * REDIS_RETRY_BASE_MS, REDIS_RETRY_MAX_MS);
}
