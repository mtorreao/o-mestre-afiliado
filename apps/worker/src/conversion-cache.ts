/**
 * Cache de conversão de URLs no Redis.
 *
 * Evita bater na API do marketplace se a mesma URL já foi convertida
 * recentemente para outro grupo fonte.
 *
 * Chave:   mirror:conversion:{sha256-da-url}
 * Valor:   { convertedUrl, marketplace, timestamp }
 * TTL:     1 hora (configurável via env WORKER_CONVERSION_CACHE_TTL)
 *
 * Falha silenciosa: se Redis estiver indisponível, o cache é desabilitado
 * e a conversão segue normalmente (API do marketplace).
 */

import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import {
  MIRROR_CONVERSION_CACHE_PREFIX,
  MIRROR_CONVERSION_CACHE_TTL,
} from '@omestre/shared';

// ─── Interfaces ────────────────────────────────────────────────────────

export interface CachedConversion {
  convertedUrl: string | null;
  marketplace: string;
  timestamp: string;
}

// ─── Conexão Redis (lazy singleton, mesmo padrão da API) ───────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
let redis: Redis | null = null;
let enabled = true;

function getCacheRedis(): Redis | null {
  if (!enabled) return null;
  if (redis) return redis;

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 2) {
          enabled = false;
          return null; // stops retrying, desliga cache
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    redis.on('error', () => {
      enabled = false;
    });
  } catch {
    enabled = false;
    return null;
  }

  return redis;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Gera a chave do cache a partir da URL original.
 * Usa SHA256 para hash determinístico e sem colisão prática.
 */
function urlToCacheKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return `${MIRROR_CONVERSION_CACHE_PREFIX}${hash}`;
}

// ─── API pública ────────────────────────────────────────────────────────

/**
 * Busca resultado de conversão no cache.
 * Retorna null se não encontrado ou Redis indisponível.
 */
export async function getCachedConversion(
  url: string,
): Promise<CachedConversion | null> {
  const r = getCacheRedis();
  if (!r) return null;

  try {
    const raw = await r.get(urlToCacheKey(url));
    if (!raw) return null;
    return JSON.parse(raw) as CachedConversion;
  } catch {
    return null;
  }
}

/**
 * Salva resultado de conversão no cache.
 * Falha silenciosa se Redis indisponível.
 */
export async function setCachedConversion(
  url: string,
  result: CachedConversion,
): Promise<void> {
  const r = getCacheRedis();
  if (!r) return;

  const ttl = parseInt(
    process.env.WORKER_CONVERSION_CACHE_TTL || String(MIRROR_CONVERSION_CACHE_TTL),
    10,
  );

  try {
    await r.setex(urlToCacheKey(url), ttl, JSON.stringify(result));
  } catch {
    // silencia
  }
}

/**
 * Invalida explicitamente uma entrada do cache de conversão.
 * Útil para forçar reconversão em caso de erro detectado.
 */
export async function invalidateCachedConversion(url: string): Promise<void> {
  const r = getCacheRedis();
  if (!r) return;

  try {
    await r.del(urlToCacheKey(url));
  } catch {
    // silencia
  }
}
