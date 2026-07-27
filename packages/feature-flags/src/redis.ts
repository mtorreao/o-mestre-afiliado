/**
 * Singleton Redis best-effort para métrica de impacto e PubSub de invalidação.
 *
 * NUNCA deve bloquear a avaliação de feature flags. Se o Redis não estiver
 * disponível, métrica e PubSub simplesmente não funcionam — a flag ainda é
 * avaliada usando o cache local + PostgreSQL (fonte da verdade).
 */
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';

let redis: Redis | null = null;
let connected = false;

export function getFlagRedis(): Redis | null {
  if (connected && redis) return redis;
  if (redis && !connected) return null; // tentou mas falhou
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy: () => null, // sem retry — best-effort
      lazyConnect: true,
    });
    connected = true;
    redis.on('error', () => {
      connected = false;
    });
  } catch {
    return null;
  }
  return redis;
}

export function isFlagRedisConnected(): boolean {
  return connected && redis !== null;
}
