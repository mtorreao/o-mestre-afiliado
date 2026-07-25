/**
 * Rate Limiter baseado em Redis para controle de envio de mensagens.
 *
 * Extraído de apps/worker/src/rate-limiter.ts para apps/dispatcher/src/rate-limiter.ts.
 * Apenas o Dispatcher precisa de rate limiting (o Ingestor não envia nada).
 *
 * NÍVEL 1 — Por instância (instanceName)
 * NÍVEL 2 — Sub por grupo destino (targetGroupJid)
 */

import Redis from 'ioredis';
import { WhatsAppInstanceRepository } from '@omestre/db';

interface RateLimitConfig {
  maxMsgs: number;
  windowSec: number;
  cachedAt: number;
}

const CONFIG_CACHE_TTL_MS = 60_000;
const configCache = new Map<string, RateLimitConfig>();

const instanceRepo = new WhatsAppInstanceRepository();

let redis: Redis | null = null;
let enabled = true;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';

function getRateLimiterRedis(): Redis | null {
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

async function getInstanceConfig(instanceName: string): Promise<{ maxMsgs: number; windowSec: number }> {
  const cached = configCache.get(instanceName);
  if (cached && Date.now() - cached.cachedAt < CONFIG_CACHE_TTL_MS) {
    return { maxMsgs: cached.maxMsgs, windowSec: cached.windowSec };
  }

  try {
    const instance = await instanceRepo.findByInstanceName(instanceName);
    if (instance) {
      const config: RateLimitConfig = {
        maxMsgs: instance.rateLimitMaxMsgs,
        windowSec: instance.rateLimitWindowSec,
        cachedAt: Date.now(),
      };
      configCache.set(instanceName, config);
      return { maxMsgs: config.maxMsgs, windowSec: config.windowSec };
    }
  } catch {
    // Fallback para defaults
  }

  return { maxMsgs: 15, windowSec: 300 };
}

export function clearInstanceConfigCache(instanceName: string): void {
  configCache.delete(instanceName);
}

// ─── Nível 1 ─────────────────────────────────────────────────────────

function rateLimitKey(instanceName: string, windowSec: number): string {
  const windowIndex = Math.floor(Date.now() / (windowSec * 1000));
  return `mirror:ratelimit:${instanceName}:${windowIndex}`;
}

function msUntilWindowEnd(windowSec: number): number {
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowIndex = Math.floor(now / windowMs);
  const windowStart = windowIndex * windowMs;
  return windowStart + windowMs - now;
}

export async function tryAcquireSlot(
  instanceName: string,
): Promise<{ acquired: boolean; waitMs: number }> {
  const r = getRateLimiterRedis();
  if (!r) return { acquired: true, waitMs: 0 };

  const { maxMsgs, windowSec } = await getInstanceConfig(instanceName);

  try {
    const key = rateLimitKey(instanceName, windowSec);
    const count = await r.incr(key);

    if (count === 1) {
      await r.expire(key, windowSec * 2);
    }

    if (count <= maxMsgs) {
      return { acquired: true, waitMs: 0 };
    }

    const waitMs = msUntilWindowEnd(windowSec);
    return { acquired: false, waitMs: Math.max(waitMs, 100) };
  } catch {
    return { acquired: true, waitMs: 0 };
  }
}

export async function waitForSlot(
  instanceName: string,
  maxTotalWaitMs: number = 300_000,
): Promise<boolean> {
  const deadline = Date.now() + maxTotalWaitMs;

  await sleep(500);

  while (Date.now() < deadline) {
    const { acquired, waitMs } = await tryAcquireSlot(instanceName);
    if (acquired) return true;

    const pollInterval = Math.min(waitMs, 1000);
    await sleep(pollInterval);
  }

  return false;
}

// ─── Nível 2 ─────────────────────────────────────────────────────────

function subRateLimitKey(groupJid: string, windowSec: number): string {
  const windowIndex = Math.floor(Date.now() / (windowSec * 1000));
  return `mirror:ratelimit:group:${groupJid}:${windowIndex}`;
}

export async function tryAcquireGroupSlot(
  groupJid: string,
  maxMsgs: number,
  windowSec: number,
): Promise<{ acquired: boolean; waitMs: number }> {
  const r = getRateLimiterRedis();
  if (!r) return { acquired: true, waitMs: 0 };

  try {
    const key = subRateLimitKey(groupJid, windowSec);
    const count = await r.incr(key);

    if (count === 1) {
      await r.expire(key, windowSec * 2);
    }

    if (count <= maxMsgs) {
      return { acquired: true, waitMs: 0 };
    }

    const waitMs = msUntilWindowEnd(windowSec);
    return { acquired: false, waitMs: Math.max(waitMs, 100) };
  } catch {
    return { acquired: true, waitMs: 0 };
  }
}

export async function waitForGroupSlot(
  groupJid: string,
  maxMsgs: number,
  windowSec: number,
  maxTotalWaitMs: number = 300_000,
): Promise<boolean> {
  const deadline = Date.now() + maxTotalWaitMs;

  await sleep(500);

  while (Date.now() < deadline) {
    const { acquired, waitMs } = await tryAcquireGroupSlot(groupJid, maxMsgs, windowSec);
    if (acquired) return true;

    const pollInterval = Math.min(waitMs, 1000);
    await sleep(pollInterval);
  }

  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));