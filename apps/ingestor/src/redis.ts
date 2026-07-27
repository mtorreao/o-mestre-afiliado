/**
 * Redis singleton compartilhado pelo Ingestor.
 *
 * Lazy connect + retryStrategy com backoff. Retorna null se a conexão
 * falhar na inicialização — callers devem tratar o modo degradado
 * (fail-open).
 */
import Redis from 'ioredis';
import { config } from './config.ts';

let redisClient: Redis | null = null;

/**
 * Retorna a conexão Redis singleton, criando-a sob demanda.
 *
 * Se a inicialização falhar, retorna null — callers devem fazer
 * fail-open (pular a operação que dependeria do Redis).
 */
export function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  try {
    redisClient = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });
  } catch {
    return null;
  }
  return redisClient;
}
