/**
 * Singleton lazy de `ioredis` para a infra compartilhada de feature flags.
 *
 * O objetivo aqui é best-effort: se o Redis estiver offline, métrica e PubSub
 * simplesmente não funcionam — nunca bloqueamos a avaliação de flag por causa
 * do Redis.
 *
 * Uso:
 *   const r = getFlagRedis();
 *   if (r) await r.publish(FLAG_INVALIDATE_CHANNEL, 'maintenance_mode');
 *
 * Para testes, passe `ioredisMock` (ou qualquer factory compatível com
 * `new Redis(url, opts)`) como terceiro parâmetro:
 *   getFlagRedis(redisUrl, undefined, () => new RedisMock())
 */

import Redis from 'ioredis';

type RedisFactory = () => Redis;

/** Override injetável. Default = `ioredis`. */
let factory: RedisFactory = () => new Redis();

/**
 * Injeta o factory de cliente Redis. Usado por testes com ioredis-mock.
 * NÃO usar em código de produção.
 */
export function __setRedisFactoryForTesting(f: RedisFactory): void {
  factory = f;
}

let cached: Redis | null = null;
let attempted = false;

/**
 * Retorna o cliente Redis singleton, criando-o sob demanda.
 * Retorna `null` se Redis indisponível — callers devem fazer fail-open.
 *
 * @param redisUrl URL do Redis (ex: `redis://localhost:6379`). Se omitido,
 *                 usa `REDIS_URL` do env.
 */
export function getFlagRedis(redisUrl?: string): Redis | null {
  if (cached) return cached;
  if (attempted) return null; // já falhou uma vez — não tenta de novo nesse processo

  const url = redisUrl ?? process.env.REDIS_URL ?? '';
  if (!url) {
    attempted = true;
    return null;
  }

  try {
    cached = factory();
  } catch {
    attempted = true;
    return null;
  }

  try {
    cached.on('error', () => {
      // Falha de conexão zera o cache para permitir retry no próximo getFlagRedis().
      cached = null;
      attempted = false;
    });
  } catch {
    cached = null;
    attempted = true;
    return null;
  }

  return cached;
}

/**
 * Limpa o estado de singleton. Usado por testes para começar do zero
 * entre casos.
 */
export function __resetFlagRedisForTesting(): void {
  cached = null;
  attempted = false;
  factory = () => new Redis();
}
