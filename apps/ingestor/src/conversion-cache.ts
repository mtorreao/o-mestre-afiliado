/**
 * Cache de conversão de URLs no Redis.
 *
 * Extraído de apps/worker/src/conversion-cache.ts para apps/ingestor/src/conversion-cache.ts.
 * Apenas o Ingestor converte URLs (Dispatcher só envia).
 */

import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import {
  MIRROR_CONVERSION_CACHE_PREFIX,
  MIRROR_CONVERSION_CACHE_TTL,
  makeLogger,
} from '@omestre/shared';
import { config } from './config.ts';

const log = makeLogger('ingestor');

export interface CachedConversion {
  convertedUrl: string | null;
  marketplace: string;
  timestamp: string;
}

const REDIS_URL = config.REDIS_URL;
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
          return null;
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

function urlToCacheKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return `${MIRROR_CONVERSION_CACHE_PREFIX}${hash}`;
}

/** Exportado apenas para teste unitário. */
export const _testUrlToCacheKey = urlToCacheKey;

/**
 * Injeta um Redis mock para testes unitários. Quando `mockRedis` é null,
 * o cache desabilita (enabled=false) para evitar lazy-connect real.
 */
export function _setRedisForTest(mockRedis: Redis | null): void {
  redis = mockRedis;
  if (mockRedis === null) {
    enabled = false;
  } else {
    enabled = true;
  }
}

/**
 * Força o estado "enabled" para testes.
 */
export function _setEnabledForTest(value: boolean): void {
  enabled = value;
}

export async function getCachedConversion(url: string): Promise<CachedConversion | null> {
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

export async function setCachedConversion(url: string, result: CachedConversion): Promise<void> {
  const r = getCacheRedis();
  if (!r) return;

  const ttl = parseInt(
    config.WORKER_CONVERSION_CACHE_TTL || String(MIRROR_CONVERSION_CACHE_TTL),
    10,
  );

  try {
    await r.setex(urlToCacheKey(url), ttl, JSON.stringify(result));
  } catch {
    // silencia
  }
}

export async function invalidateCachedConversion(url: string): Promise<void> {
  const r = getCacheRedis();
  if (!r) return;

  try {
    await r.del(urlToCacheKey(url));
  } catch {
    // silencia
  }
}
