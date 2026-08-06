/**
 * Cache de sessões no Redis.
 *
 * Camada L1 sobre o SessionRepository (Postgres). TTL de 5 minutos.
 *
 * Decisão: o token de sessão é a chave de cache (`omestre:admin:session:<token>`).
 * Vantagem: lookup O(1), TTL nativo, invalidação trivial.
 * Invalidação: ao destruir/logout, chamamos `invalidateCache()` (DEL). Quando o
 * token expira naturalmente, o Redis remove sozinho (TTL).
 *
 * Best-effort: se Redis está offline, o cache é simplesmente ignorado. O
 * SessionRepository (Postgres) é a fonte da verdade — `readThroughSession`
 * faz fallback automaticamente.
 */
import Redis from 'ioredis';

const CACHE_PREFIX = 'omestre:admin:session:';
const CACHE_TTL_SECONDS = 5 * 60; // 5 minutos

let cached: Redis | null = null;
let attempted = false;

/** Cria o cliente Redis singleton. Retorna null se REDIS_URL ausente (fail-open). */
function getRedis(): Redis | null {
  if (cached) return cached;
  if (attempted) return null;
  const url = process.env['REDIS_URL'];
  if (!url) {
    attempted = true;
    return null;
  }
  try {
    cached = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      // Fail-fast: o SessionRepository assume que cache é best-effort.
      connectTimeout: 2_000,
    });
    cached.on('error', () => {
      // Não derruba o servidor — apenas invalida o singleton para
      // permitir retry na próxima chamada.
      cached?.disconnect();
      cached = null;
      attempted = false;
    });
    return cached;
  } catch {
    attempted = true;
    return null;
  }
}

export interface CachedSession {
  id: string;
  email: string;
  expiresAt: string; // ISO string — JSON não tem Date
}

/** Serializa uma sessão para o cache. */
export function serializeSession(s: { id: string; email: string; expiresAt: Date }): CachedSession {
  return { id: s.id, email: s.email, expiresAt: s.expiresAt.toISOString() };
}

/** Desserializa sessão do cache. Retorna null se expirada (defesa em profundidade). */
export function deserializeSession(raw: string, now: Date = new Date()): CachedSession | null {
  try {
    const parsed = JSON.parse(raw) as CachedSession;
    if (typeof parsed.id !== 'string' || typeof parsed.email !== 'string') return null;
    if (new Date(parsed.expiresAt).getTime() <= now.getTime()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Lê do cache. Retorna null se não existe, expirou, ou Redis offline. */
export async function getCachedSession(id: string): Promise<CachedSession | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(CACHE_PREFIX + id);
    if (!raw) return null;
    return deserializeSession(raw);
  } catch {
    return null;
  }
}

/** Escreve no cache com TTL de 5 minutos. Best-effort. */
export async function setCachedSession(s: CachedSession): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.set(CACHE_PREFIX + s.id, JSON.stringify(s), 'EX', CACHE_TTL_SECONDS);
  } catch {
    // best-effort — ignora erros de cache
  }
}

/** Remove do cache (logout, invalidação). Best-effort. */
export async function invalidateCachedSession(id: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(CACHE_PREFIX + id);
  } catch {
    // best-effort
  }
}

/** Encerra o singleton Redis. Usado em testes/shutdown. */
export function resetCacheForTesting(): void {
  cached?.disconnect();
  cached = null;
  attempted = false;
}

/** Injeta cliente Redis mockado. Apenas para testes. */
export function __setCacheClientForTesting(client: Redis | null): void {
  cached?.disconnect();
  cached = client;
  attempted = client === null;
}
