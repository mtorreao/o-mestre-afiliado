/**
 * Lógica PURA do wrapper Redis.
 *
 * Serialização/deserialização de valores de cache e montagem dos
 * argumentos de stream — sem conexão real. O I/O fica em `redis.ts`.
 */

/**
 * Serializa um valor para armazenamento no cache (JSON).
 */
export function serializeCacheValue(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * Deserializa um valor lido do cache.
 * Retorna null para: valor ausente (null/''), JSON inválido.
 */
export function deserializeCacheValue<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Monta os argumentos do XADD para publicar uma mensagem num stream:
 * [stream, '*', 'payload', JSON]. A mensagem vai serializada no campo
 * `payload` com ID auto-gerado pelo Redis (`*`).
 */
export function buildStreamAddArgs(
  stream: string,
  message: object,
): [stream: string, id: '*', field: 'payload', payload: string] {
  return [stream, '*', 'payload', JSON.stringify(message)];
}

/**
 * Estratégia de retry da conexão ioredis: backoff linear de 200ms
 * (cap 1000ms); desiste (null) após 3 tentativas.
 */
export function computeRetryDelay(times: number): number | null {
  if (times > 3) return null;
  return Math.min(times * 200, 1000);
}
