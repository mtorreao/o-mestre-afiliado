/**
 * Redis singleton compartilhado pelo Ingestor.
 *
 * Lazy connect + retryStrategy com backoff. Retorna null se a conexão
 * falhar na inicialização — callers devem tratar o modo degradado
 * (fail-open).
 *
 * A lógica de cálculo do backoff de retry (`redisRetryDelay`) é PURA
 * (sem I/O) e foi extraída para permitir teste unitário — vive inline
 * abaixo (é trivial) porém também exportada para cobertura 100%.
 */
import Redis from 'ioredis';
import { config } from './config.ts';
import { redisRetryDelay } from './redis-pure.ts';

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
      retryStrategy: redisRetryDelay,
      lazyConnect: true,
    });
  } catch {
    return null;
  }
  return redisClient;
}
