/**
 * Rate Limiter baseado em Redis para controle de envio de mensagens.
 *
 * Estratégia: fixed window com contagem atômica via Redis INCR.
 *
 * NÍVEL 1 — Por instância (instanceName):
 *   Cada instância WhatsApp ("user-{id}") tem limite de N mensagens
 *   a cada X segundos, configurável na tabela user_whatsapp_instances.
 *   Chave: mirror:ratelimit:{instanceName}:{windowIndex}
 *
 * NÍVEL 2 — Sub por grupo destino (targetGroupJid):
 *   Cada grupo de destino tem seu próprio limite, configurável no mirror.
 *   Chave: mirror:ratelimit:group:{groupJid}:{windowIndex}
 *
 * Se o limite for atingido, a thread espera o reset da janela e tenta
 * novamente — nenhuma mensagem é descartada, apenas atrasada.
 *
 * Config via banco (userWhatsAppInstances):
 *   rate_limit_max_msgs   — limite por janela (default: 15)
 *   rate_limit_window_sec — duração da janela em segundos (default: 300 = 5 min)
 *
 * Config via mirrors table (sub-rate por grupo):
 *   sub_rate_limit_max_msgs    — limite por janela (default: 5)
 *   sub_rate_limit_window_sec  — duração da janela (default: 300 = 5 min)
 *
 * Fallback: se Redis estiver offline, permite envio sem restrição
 * para não travar o pipeline.
 */
import Redis from 'ioredis';
import { WhatsAppInstanceRepository } from '@omestre/db';

// ─── Cache local das configs de rate limit ──────────────────────────
// Evita consultar o banco a cada mensagem.
// TTL: 60 segundos — fresco o suficiente para mudanças manuais.

interface RateLimitConfig {
  maxMsgs: number;
  windowSec: number;
  cachedAt: number;
}

const CONFIG_CACHE_TTL_MS = 60_000;
const configCache = new Map<string, RateLimitConfig>();

const instanceRepo = new WhatsAppInstanceRepository();

// ─── Conexão Redis (lazy singleton) ──────────────────────────────────

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
          return null; // stops retrying, desliga rate limiter
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

// ─── Config lookup ──────────────────────────────────────────────────

/**
 * Busca a configuração de rate limit de uma instância no banco,
 * com cache local de 60s para evitar consultas repetidas.
 */
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
    // Fallback para defaults se banco indisponível
  }

  // Defaults hardcoded como fallback seguro
  return { maxMsgs: 15, windowSec: 300 };
}

/**
 * Limpa o cache local de config de uma instância.
 * Útil após alteração do rate limit via API.
 */
export function clearInstanceConfigCache(instanceName: string): void {
  configCache.delete(instanceName);
}

// ─── Nível 1: Rate limit por instância ─────────────────────────────

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

/**
 * Tenta adquirir um slot no rate limit da instância.
 *
 * Busca a configuração (maxMsgs, windowSec) do banco com cache local de 60s.
 *
 * Retorna:
 *   - { acquired: true } — slot concedido, pode enviar
 *   - { acquired: false, waitMs } — rate limit excedido, aguardar
 */
export async function tryAcquireSlot(
  instanceName: string,
): Promise<{ acquired: boolean; waitMs: number }> {
  const r = getRateLimiterRedis();
  if (!r) return { acquired: true, waitMs: 0 };

  const { maxMsgs, windowSec } = await getInstanceConfig(instanceName);

  try {
    const key = rateLimitKey(instanceName, windowSec);
    const count = await r.incr(key);

    // Na primeira vez, define o TTL (2x a janela para segurança)
    if (count === 1) {
      await r.expire(key, windowSec * 2);
    }

    if (count <= maxMsgs) {
      return { acquired: true, waitMs: 0 };
    }

    // Rate limit excedido — calcula tempo restante da janela
    const waitMs = msUntilWindowEnd(windowSec);
    return { acquired: false, waitMs: Math.max(waitMs, 100) };
  } catch {
    // Falha silenciosa: se Redis caiu, deixa passar
    return { acquired: true, waitMs: 0 };
  }
}

/**
 * Aguarda até que a janela atual expire e um slot fique disponível
 * no rate limit da instância.
 *
 * Faz polling a cada 1s para evitar busy-wait.
 *
 * @param instanceName Nome da instância Evolution
 * @param maxTotalWaitMs Tempo máximo total de espera (default: 5 min)
 */
export async function waitForSlot(
  instanceName: string,
  maxTotalWaitMs: number = 300_000, // 5 minutos
): Promise<boolean> {
  const deadline = Date.now() + maxTotalWaitMs;

  await sleep(500);

  while (Date.now() < deadline) {
    const { acquired, waitMs } = await tryAcquireSlot(instanceName);
    if (acquired) return true;

    const pollInterval = Math.min(waitMs, 1000);
    await sleep(pollInterval);
  }

  return false; // timeou
}

// ─── Nível 2: Sub-rate limit por grupo destino ─────────────────────

function subRateLimitKey(groupJid: string, windowSec: number): string {
  const windowIndex = Math.floor(Date.now() / (windowSec * 1000));
  return `mirror:ratelimit:group:${groupJid}:${windowIndex}`;
}

/**
 * Tenta adquirir um slot no sub-rate limit de um grupo de destino.
 *
 * @param groupJid JID do grupo de destino
 * @param maxMsgs Limite de mensagens por janela para este grupo
 * @param windowSec Janela em segundos
 */
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

/**
 * Aguarda até que um slot no sub-rate limit do grupo destino fique disponível.
 */
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

// ─── Utility ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
