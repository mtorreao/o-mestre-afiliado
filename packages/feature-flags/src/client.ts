/**
 * Client de feature flags — cache local, métrica Redis e PubSub.
 *
 * Fluxo de avaliação:
 *   1. Cache local (TTL 10s) → check mais rápido
 *   2. Cache expirou → busca no PostgreSQL (fonte da verdade)
 *   3. Sem linha no banco → usa default do registry
 *   4. Métrica: INCR no Redis por minuto (best-effort)
 *   5. Invalidação: PubSub Redis para propagação imediata
 */
import { FeatureFlagRepository } from '@omestre/db';
import { getFlagRedis } from './redis.ts';
import { FLAGS } from './registry.ts';
import type { FlagKey } from './registry.ts';

const CACHE_TTL_MS = 10_000;

const flagRepo = new FeatureFlagRepository();

// Cache em memória: key → { enabled, cachedAt }
const cache = new Map<string, { enabled: boolean; cachedAt: number }>();

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'feature-flags',
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

/**
 * Avalia se uma feature flag está habilitada.
 *
 * Cache TTL 10s → fallback para PostgreSQL → default do registry.
 * Redis indisponível não bloqueia — usa default.
 */
export async function isFeatureEnabled(key: FlagKey): Promise<boolean> {
  const def = FLAGS[key];
  if (!def) return false;

  // 1. Cache local quente
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    recordFlagCheck(key);
    return cached.enabled;
  }

  // 2. Busca no PostgreSQL (fonte da verdade)
  try {
    const row = await flagRepo.findByKey(key);
    const enabled = row?.enabled ?? def.defaultEnabled;
    cache.set(key, { enabled, cachedAt: Date.now() });
    recordFlagCheck(key);
    return enabled;
  } catch (err) {
    log('error', 'Erro ao buscar feature flag do banco', {
      key,
      error: String(err),
    });
    const fallback = def.defaultEnabled;
    cache.set(key, { enabled: fallback, cachedAt: Date.now() });
    recordFlagCheck(key);
    return fallback;
  }
}

/**
 * Registra uma avaliação de flag no Redis para métrica de impacto.
 * Best-effort: falha Redis não bloqueia.
 */
function recordFlagCheck(key: string): void {
  try {
    const r = getFlagRedis();
    if (!r) return;
    const now = new Date();
    const bucket = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`;
    const redisKey = `omestre:flag:stats:${key}:${bucket}`;
    r.incr(redisKey);
    r.expire(redisKey, 7200);
  } catch {
    // best-effort
  }
}

/**
 * Soma as avaliações de uma flag nos últimos ~60 minutos.
 * Lê os buckets Redis e agrega.
 * Retorna 0 se Redis não estiver disponível.
 */
export async function countFlagChecks(key: string): Promise<number> {
  try {
    const r = getFlagRedis();
    if (!r) return 0;

    const now = new Date();
    const keys: string[] = [];
    for (let i = 0; i < 60; i++) {
      const t = new Date(now.getTime() - i * 60_000);
      const bucket = `${t.getUTCFullYear()}${String(t.getUTCMonth() + 1).padStart(2, '0')}${String(t.getUTCDate()).padStart(2, '0')}${String(t.getUTCHours()).padStart(2, '0')}${String(t.getUTCMinutes()).padStart(2, '0')}`;
      keys.push(`omestre:flag:stats:${key}:${bucket}`);
    }

    const values = await r.mget(...keys);
    return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Invalida o cache local de uma flag — força a próxima avaliação a buscar
 * do PostgreSQL.
 */
export function invalidateFlagCache(key: string): void {
  cache.delete(key);
}

// ─── PubSub de invalidação ──────────────────────────────────────────

let pubSubInitialized = false;

/**
 * Inicia a escuta do canal Redis `omestre:flag:invalidate` para invalidar
 * cache local quando um toggle for alterado por outro processo.
 */
export function initFlagInvalidation(): void {
  if (pubSubInitialized) return;
  pubSubInitialized = true;

  const r = getFlagRedis();
  if (!r) return;

  const sub = r.duplicate();
  sub.subscribe('omestre:flag:invalidate', (err) => {
    if (err) {
      log('error', 'Erro ao subscrever canal de invalidação', { error: String(err) });
      return;
    }
    log('info', 'Inscrito no canal omestre:flag:invalidate');
  });

  sub.on('message', (_channel, message) => {
    const flagKey = message.trim();
    invalidateFlagCache(flagKey);
  });
}

/**
 * Publica uma mensagem no canal `omestre:flag:invalidate` para notificar
 * outros processos que o cache local deve ser invalidado.
 */
export function publishFlagInvalidation(key: string): void {
  const r = getFlagRedis();
  if (!r) return;
  try {
    r.publish('omestre:flag:invalidate', key);
  } catch {
    // best-effort
  }
}

/**
 * Aguarda até que o cache de uma flag seja invalidado (PubSub) ou o
 * timeout expire. Usado pelo Dispatcher para não dormir cegamente.
 */
export async function waitForFlagChange(key: string, timeoutMs: number = 5_000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const r = getFlagRedis();
    if (!r) {
      clearTimeout(timer);
      resolve();
      return;
    }
    const sub = r.duplicate();
    sub.subscribe('omestre:flag:invalidate');
    sub.on('message', (_channel, message) => {
      if (message.trim() === key) {
        clearTimeout(timer);
        invalidateFlagCache(key);
        sub.unsubscribe();
        resolve();
      }
    });
  });
}
