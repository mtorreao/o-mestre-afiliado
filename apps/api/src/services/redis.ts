/**
 * Redis connection singleton.
 *
 * Usa a env var REDIS_URL (ex: redis://redis:6379 ou redis://localhost:5455).
 * Se não configurada, o cache é desabilitado (graceful fallback).
 *
 * Também provê fila via Redis Stream para comunicação API → Worker.
 * Diferente do PubSub (que perdia mensagens se o worker reiniciasse),
 * Stream persiste mensagens e usa consumer group com ACK explícito.
 */
import Redis from 'ioredis';

let client: Redis | null = null;
let enabled = true;

function getRedisUrl(): string | null {
  return process.env.REDIS_URL || null;
}

export function getRedis(): Redis | null {
  if (!enabled) return null;
  if (client) return client;

  const url = getRedisUrl();
  if (!url) {
    enabled = false;
    return null;
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) {
          enabled = false;
          return null; // stops retrying
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    client.on('error', () => {
      enabled = false;
    });
  } catch {
    enabled = false;
    return null;
  }

  return client;
}

/**
 * Tenta ler do cache. Retorna null se Redis não disponível ou chave não existe.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Salva no cache com TTL em segundos.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.setex(key, ttlSeconds, JSON.stringify(value));
  } catch {
    // silencia falha de cache
  }
}

/**
 * Invalida uma chave do cache.
 */
export async function cacheDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch {
    // silencia
  }
}

// ─── Redis Stream (substitui PubSub) ─────────────────────────────────

/**
 * Adiciona uma mensagem a um Redis Stream.
 *
 * Usa XADD com `*` (ID auto-gerado pelo Redis). A mensagem é serializada
 * como JSON no campo `payload`.
 *
 * Retorna false se Redis estiver desabilitado.
 * Retorna a ID da mensagem no stream em caso de sucesso.
 */
export async function streamAdd(stream: string, message: object): Promise<string | false> {
  const r = getRedis();
  if (!r) return false;
  try {
    const id = await r.xadd(stream, '*', 'payload', JSON.stringify(message));
    return id ?? false;
  } catch {
    return false;
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────

/**
 * Fecha a conexão Redis (usado em graceful shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
