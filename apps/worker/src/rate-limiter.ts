/**
 * Rate Limiter baseado em Redis para controle de envio de mensagens.
 *
 * Estratégia: fixed window (1 minuto) com contagem atômica via INCR.
 * Cada instância (instanceName) tem um limite de N mensagens por janela.
 * Se o limite for atingido, a thread espera o reset da janela e tenta
 * novamente — nenhuma mensagem é descartada, apenas atrasada.
 *
 * Chave Redis: mirror:ratelimit:{instanceName}:{epochMinute}
 * TTL:         WORKER_RATE_LIMIT_WINDOW_SEC * 2 (janela extra de segurança)
 *
 * Config via env:
 *   WORKER_RATE_LIMIT_MAX_MSGS  — limite por janela (default: 20)
 *   WORKER_RATE_LIMIT_WINDOW_SEC — duração da janela em segundos (default: 60)
 */

import Redis from 'ioredis';

// ─── Config ──────────────────────────────────────────────────────────

const RATE_LIMIT_MAX_MSGS = parseInt(
  process.env.WORKER_RATE_LIMIT_MAX_MSGS || '20',
  10,
);
const RATE_LIMIT_WINDOW_SEC = parseInt(
  process.env.WORKER_RATE_LIMIT_WINDOW_SEC || '60',
  10,
);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';

// ─── Conexão Redis (lazy singleton) ──────────────────────────────────

let redis: Redis | null = null;
let enabled = true;

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

// ─── Rate Limiter API ───────────────────────────────────────────────

/**
 * Gera a chave Redis para o bucket da janela atual de uma instância.
 *
 * Formato: mirror:ratelimit:{instanceName}:{epochMinute}
 * O epochMinute é baseado no timestamp atual dividido pela janela,
 * garantindo alinhamento com a janela configurada.
 */
function rateLimitKey(instanceName: string): string {
  const windowIndex = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SEC * 1000));
  return `mirror:ratelimit:${instanceName}:${windowIndex}`;
}

/**
 * Calcula quantos ms faltam para o fim da janela atual.
 */
function msUntilWindowEnd(): number {
  const now = Date.now();
  const windowMs = RATE_LIMIT_WINDOW_SEC * 1000;
  const windowIndex = Math.floor(now / windowMs);
  const windowStart = windowIndex * windowMs;
  return windowStart + windowMs - now;
}

/**
 * Tenta adquirir um slot no rate limiter.
 *
 * Retorna:
 *   - { acquired: true } — slot concedido, pode enviar
 *   - { acquired: false, waitMs: number } — rate limit excedido,
 *     aguardar waitMs ms antes de tentar novamente
 *
 * Falha silenciosa: se Redis estiver indisponível, retorna acquired=true
 * para não travar o pipeline.
 */
export async function tryAcquireSlot(
  instanceName: string,
): Promise<{ acquired: boolean; waitMs: number }> {
  const r = getRateLimiterRedis();
  if (!r) return { acquired: true, waitMs: 0 };

  try {
    const key = rateLimitKey(instanceName);
    const count = await r.incr(key);

    // Na primeira vez, define o TTL (2x a janela para segurança)
    if (count === 1) {
      await r.expire(key, RATE_LIMIT_WINDOW_SEC * 2);
    }

    if (count <= RATE_LIMIT_MAX_MSGS) {
      return { acquired: true, waitMs: 0 };
    }

    // Rate limit excedido — calcula tempo restante da janela
    const waitMs = msUntilWindowEnd();
    return { acquired: false, waitMs: Math.max(waitMs, 100) };
  } catch {
    // Falha silenciosa: se Redis caiu, deixa passar
    return { acquired: true, waitMs: 0 };
  }
}

/**
 * Aguarda até que a janela atual expire e um slot fique disponível.
 * Faz polling a cada 1s para evitar busy-wait.
 *
 * Retorna true quando consegue enviar, ou false se o timeout total
 * for excedido (proteção contra loop infinito).
 *
 * @param instanceName Nome da instância Evolution
 * @param maxTotalWaitMs Tempo máximo total de espera (default: 5 min)
 */
export async function waitForSlot(
  instanceName: string,
  maxTotalWaitMs: number = 300_000, // 5 minutos
): Promise<boolean> {
  const deadline = Date.now() + maxTotalWaitMs;

  // Pequeno delay inicial para não floodar Redis no loop
  await sleep(500);

  while (Date.now() < deadline) {
    const { acquired, waitMs } = await tryAcquireSlot(instanceName);
    if (acquired) return true;

    // Se waitMs for muito grande (ex: > 10s), faz polling a cada 1s
    const pollInterval = Math.min(waitMs, 1000);
    await sleep(pollInterval);
  }

  return false; // timeou
}

// ─── Utility ─────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
