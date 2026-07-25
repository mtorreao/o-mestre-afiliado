/**
 * Dead Letter Queue — Mensagens com falha permanente após todas as tentativas.
 *
 * Armazena no Redis (LIST + Sorted Set):
 *   mirror:dlq:entries  — LIST com payloads JSON dos itens
 *   mirror:dlq:index     — ZSET com {item-id → timestamp} para ordenação
 *
 * Extraído de apps/worker/src/dead-letter-queue.ts para @omestre/worker-common.
 * DLQ é compartilhada entre Ingestor, Dispatcher e API (reuso da conexão Redis).
 */

import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import type { MirrorDLQEntry, RawMessageEvent, SendEvent } from '@omestre/shared';
import {
  MIRROR_DLQ_LIST,
  MIRROR_DLQ_INDEX,
  MIRROR_DLQ_TTL,
} from '@omestre/shared';

// ─── Config ───────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';

// ─── Tipos ────────────────────────────────────────────────────────────

export interface DLQPushParams {
  event: RawMessageEvent | SendEvent;
  failureReason: string;
  attempts: number;
  lastError: string;
  marketplace?: string;
  originalUrl?: string;
  conversionSuccess?: boolean;
  targetGroupJids?: string[];
}

export interface DLQListOptions {
  offset?: number;
  limit?: number;
}

export interface DLQListResult {
  items: MirrorDLQEntry[];
  total: number;
  offset: number;
  limit: number;
}

// ─── Conexão Redis (lazy singleton) ──────────────────────────────────

let redis: Redis | null = null;
let dlqEnabled = true;

function getDLQRedis(): Redis | null {
  if (!dlqEnabled) return null;
  if (redis) return redis;

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 2) {
          dlqEnabled = false;
          return null;
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    redis.on('error', () => {
      dlqEnabled = false;
    });
  } catch {
    dlqEnabled = false;
    return null;
  }

  return redis;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'mirror-dlq',
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── API pública ──────────────────────────────────────────────────────

export async function pushToDLQ(params: DLQPushParams): Promise<void> {
  const r = getDLQRedis();
  if (!r) {
    log('warn', 'Redis não disponível — DLQ ignorada');
    return;
  }

  try {
    const id = randomUUID();
    const now = new Date().toISOString();

    const entry: MirrorDLQEntry = {
      id,
      event: params.event,
      failureReason: params.failureReason,
      attempts: params.attempts,
      lastError: params.lastError,
      failedAt: now,
      marketplace: params.marketplace,
      originalUrl: params.originalUrl,
      conversionSuccess: params.conversionSuccess,
      targetGroupJids: params.targetGroupJids,
      reprocessed: false,
    };

    const score = Date.now();
    const pipeline = r.pipeline();
    pipeline.rpush(MIRROR_DLQ_LIST, JSON.stringify(entry));
    pipeline.zadd(MIRROR_DLQ_INDEX, score, id);
    await pipeline.exec();

    log('info', 'Item adicionado à Dead Letter Queue', {
      dlqId: id,
      messageId: 'messageId' in params.event ? params.event.messageId : params.event.sourceMessageId,
      failureReason: params.failureReason,
      attempts: params.attempts,
      marketplace: params.marketplace,
    });
  } catch (err) {
    log('error', 'Falha ao adicionar item à DLQ', {
      error: err instanceof Error ? err.message : String(err),
      messageId: 'messageId' in params.event ? params.event.messageId : params.event.sourceMessageId,
    });
  }
}

export async function listDLQ(
  options: DLQListOptions = {},
): Promise<DLQListResult> {
  const emptyResult: DLQListResult = {
    items: [],
    total: 0,
    offset: options.offset ?? 0,
    limit: options.limit ?? 20,
  };

  const r = getDLQRedis();
  if (!r) return emptyResult;

  try {
    const total = await r.zcard(MIRROR_DLQ_INDEX);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;

    const ids = await r.zrevrange(MIRROR_DLQ_INDEX, offset, offset + limit - 1);
    if (ids.length === 0) return { ...emptyResult, total };

    const rawItems = await r.lrange(MIRROR_DLQ_LIST, 0, -1);
    const itemMap = new Map<string, MirrorDLQEntry>();
    for (const raw of rawItems) {
      try {
        const parsed = JSON.parse(raw) as MirrorDLQEntry;
        itemMap.set(parsed.id, parsed);
      } catch {
        // pula itens corrompidos
      }
    }

    const items: MirrorDLQEntry[] = [];
    for (const id of ids) {
      const item = itemMap.get(id);
      if (item) items.push(item);
    }

    return { items, total, offset, limit };
  } catch (err) {
    log('error', 'Falha ao listar DLQ', {
      error: err instanceof Error ? err.message : String(err),
    });
    return emptyResult;
  }
}

export async function getDLQItem(itemId: string): Promise<MirrorDLQEntry | null> {
  const r = getDLQRedis();
  if (!r) return null;

  try {
    const rawItems = await r.lrange(MIRROR_DLQ_LIST, 0, -1);
    for (const raw of rawItems) {
      try {
        const parsed = JSON.parse(raw) as MirrorDLQEntry;
        if (parsed.id === itemId) return parsed;
      } catch {
        // pula itens corrompidos
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function requeueFromDLQ(
  itemId: string,
  targetStream: string,
): Promise<boolean> {
  const r = getDLQRedis();
  if (!r) return false;

  try {
    const item = await getDLQItem(itemId);
    if (!item) {
      log('warn', 'Item não encontrado na DLQ para re-processamento', { dlqId: itemId });
      return false;
    }

    await r.xadd(targetStream, '*', 'payload', JSON.stringify(item.event));

    const now = new Date().toISOString();
    const updatedEntry: MirrorDLQEntry = {
      ...item,
      reprocessed: true,
      reprocessedAt: now,
      reprocessResult: 're-enfileirado no stream',
    };

    const pipeline = r.pipeline();
    const oldRaw = JSON.stringify(item);
    pipeline.lrem(MIRROR_DLQ_LIST, 1, oldRaw);
    pipeline.rpush(MIRROR_DLQ_LIST, JSON.stringify(updatedEntry));
    await pipeline.exec();

    log('info', 'Item re-enfileirado do DLQ para o stream', {
      dlqId: itemId,
      messageId: 'messageId' in item.event ? item.event.messageId : item.event.sourceMessageId,
      targetStream,
    });
    return true;
  } catch (err) {
    log('error', 'Falha ao re-enfileirar item da DLQ', {
      dlqId: itemId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function removeFromDLQ(itemId: string): Promise<boolean> {
  const r = getDLQRedis();
  if (!r) return false;

  try {
    const item = await getDLQItem(itemId);
    if (!item) {
      log('warn', 'Item não encontrado na DLQ para remoção', { dlqId: itemId });
      return false;
    }

    const pipeline = r.pipeline();
    pipeline.lrem(MIRROR_DLQ_LIST, 1, JSON.stringify(item));
    pipeline.zrem(MIRROR_DLQ_INDEX, itemId);
    await pipeline.exec();

    log('info', 'Item removido da DLQ', { dlqId: itemId });
    return true;
  } catch (err) {
    log('error', 'Falha ao remover item da DLQ', {
      dlqId: itemId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function countDLQ(): Promise<number> {
  const r = getDLQRedis();
  if (!r) return 0;

  try {
    return await r.zcard(MIRROR_DLQ_INDEX);
  } catch {
    return 0;
  }
}

export async function purgeOldDLQItems(): Promise<number> {
  const r = getDLQRedis();
  if (!r) return 0;

  try {
    const cutoff = Date.now() - MIRROR_DLQ_TTL * 1000;
    const oldIds = await r.zrangebyscore(MIRROR_DLQ_INDEX, 0, cutoff);
    if (oldIds.length === 0) return 0;

    const rawItems = await r.lrange(MIRROR_DLQ_LIST, 0, -1);
    const pipeline = r.pipeline();
    const oldIdSet = new Set(oldIds);
    let removed = 0;

    for (const raw of rawItems) {
      try {
        const parsed = JSON.parse(raw) as MirrorDLQEntry;
        if (oldIdSet.has(parsed.id)) {
          pipeline.lrem(MIRROR_DLQ_LIST, 1, raw);
          pipeline.zrem(MIRROR_DLQ_INDEX, parsed.id);
          removed++;
        }
      } catch {
        // pula itens corrompidos
      }
    }

    if (removed > 0) {
      await pipeline.exec();
      log('info', 'DLQ purged — itens antigos removidos', {
        removed,
        ttlSeconds: MIRROR_DLQ_TTL,
      });
    }

    return removed;
  } catch (err) {
    log('error', 'Falha ao fazer purge da DLQ', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}