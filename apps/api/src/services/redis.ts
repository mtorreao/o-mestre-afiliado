/**
 * Redis connection singleton.
 *
 * Usa a env var REDIS_URL (ex: redis://redis:6379 ou redis://localhost:5455).
 * Se não configurada, o cache é desabilitado (graceful fallback).
 *
 * Também provê PubSub para comunicação API → Worker.
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

// ─── PubSub ─────────────────────────────────────────────────────────

/**
 * Canal Redis para mensagens de grupos de espelhamento.
 * API → publica, Worker → consome.
 */
export const MIRROR_MESSAGE_CHANNEL = 'omestre:mirror:message';

/**
 * Publica uma mensagem no canal PubSub.
 * Retorna false se Redis estiver desabilitado.
 */
export async function publish(channel: string, message: object): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    await r.publish(channel, JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

/**
 * Cria um subscriber Redis isolado (não compartilha conexão com o client de cache).
 * O subscriber não pode fazer comandos normais — apenas subscribe.
 *
 * Retorna null se Redis estiver desabilitado.
 */
export function createSubscriber(): Redis | null {
  const url = getRedisUrl();
  if (!url) return null;

  try {
    const sub = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });
    return sub;
  } catch {
    return null;
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
