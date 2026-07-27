/**
 * Redis connection singleton.
 *
 * Usa a env var REDIS_URL (ex: redis://redis:6379 ou redis://localhost:5455).
 * Se não configurada, o cache é desabilitado (graceful fallback).
 *
 * Também provê fila via Redis Stream para comunicação API → Worker.
 * Diferente do PubSub (que perdia mensagens se o worker reiniciasse),
 * Stream persiste mensagens e usa consumer group com ACK explícito.
 */
import Redis from 'ioredis';
import { makeLogger } from '@omestre/shared';
import { config } from '../config.ts';

const log = makeLogger('api');

let client: Redis | null = null;
let enabled = true;

/**
 * Retorna a conexão Redis singleton, criando-a sob demanda.
 *
 * Se a inicialização falhar, retorna null — callers devem fazer
 * fail-open (pular a operação que dependeria do Redis).
 */
export function getRedis(): Redis | null {
  if (!enabled) return null;
  if (client) return client;

  const url = config.REDIS_URL;
  if (!url) {
    enabled = false;
    return null;
  }

  try {
    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 3) {
          enabled = false;
          return null;
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    client.on('error', () => {
      enabled = false;
    });
  } catch {
    enabled = false;
    return null;
  }

  return client;
}

/**
 * Tenta ler do cache. Retorna null se Redis não disponível ou chave não existe.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    const raw = await r.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    log('warn', 'Falha ao ler do cache', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Salva no cache com TTL em segundos.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.setex(key, ttlSeconds, JSON.stringify(value));
  } catch (err) {
    log('warn', 'Falha ao salvar no cache', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Invalida uma chave do cache.
 */
export async function cacheDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  try {
    await r.del(key);
  } catch (err) {
    log('warn', 'Falha ao deletar do cache', {
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Redis Stream (substitui PubSub) ─────────────────────────────────

/**
 * Adiciona uma mensagem a um Redis Stream.
 *
 * Usa XADD com `*` (ID auto-gerado pelo Redis). A mensagem é serializada
 * como JSON no campo `payload`.
 *
 * Retorna false se Redis estiver desabilitado.
 * Retorna a ID da mensagem no stream em caso de sucesso.
 */
export async function streamAdd(stream: string, message: object): Promise<string | false> {
  const r = getRedis();
  if (!r) return false;
  try {
    const id = await r.xadd(stream, '*', 'payload', JSON.stringify(message));
    return id ?? false;
  } catch (err) {
    log('warn', 'Falha ao adicionar ao stream', {
      stream,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────

/**
 * Fecha a conexão Redis (usado em graceful shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
