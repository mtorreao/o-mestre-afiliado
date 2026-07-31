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
import type { CatalogJob, MirrorDLQEntry, RawMessageEvent, SendEvent } from '@omestre/shared';
import { MIRROR_DLQ_LIST, MIRROR_DLQ_INDEX, MIRROR_DLQ_TTL, makeLogger } from '@omestre/shared';
import {
  buildReprocessedEntry,
  resolveDlqFetchLimit,
  sliceDlqPage,
} from './dead-letter-queue-pure.ts';
import { config } from './config.ts';

// ─── Tipos ────────────────────────────────────────────────────────────

export interface DLQPushParams {
  event: RawMessageEvent | SendEvent | CatalogJob;
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
  /** Filtra por failureReason (match exato). */
  failureReason?: string;
  /** Filtra por fila de origem: 'A' (Ingestor) ou 'B' (Dispatcher). */
  queue?: 'A' | 'B';
  /** Filtra items com failedAt >= since (ms epoch). null = sem filtro. */
  since?: number;
}

export interface DLQListResult {
  items: MirrorDLQEntry[];
  /** Total REAL da DLQ (sem filtros aplicados) — usado pelo badge no header. */
  total: number;
  offset: number;
  limit: number;
  /**
   * Total APÓS aplicar filtros in-memory (failureReason, queue, since).
   * Quando o cliente passa filtros, este é o número de items que
   * casaram; sem filtros é igual a `total`.
   * Útil pra UI saber "estou vendo X de Y".
   */
  totalFiltered: number;
}

// ─── Lógica PURA (sem Redis) ───────────────────────────────────────────
//
// As funções abaixo extraem o PARSE/SERIALIZE de um item da DLQ e a
// filtragem in-memory da listagem. São 100% testáveis sem conexão ao
// Redis. A camada de I/O (xadd/xread/lpush/lrange) fica nos callers
// `pushToDLQ` / `listDLQ` / etc.

/**
 * Tipagem do item cru serializado na DLQ (antes do parse).
 */
export type RawDLQItem = string;

/**
 * Constrói uma entrada da DLQ a partir do evento + metadados.
 * Gera `id` e `failedAt` no momento da criação (caller pode sobrescrever
 * via `now`/`idGen` em casos de replay/teste).
 *
 * Função PURO: não toca no Redis.
 */
export function buildDlqEntry(
  params: DLQPushParams,
  now: () => string = () => new Date().toISOString(),
  idGen: () => string = () => randomUUID(),
): MirrorDLQEntry {
  return {
    id: idGen(),
    event: params.event,
    failureReason: params.failureReason,
    attempts: params.attempts,
    lastError: params.lastError,
    failedAt: now(),
    marketplace: params.marketplace,
    originalUrl: params.originalUrl,
    conversionSuccess: params.conversionSuccess,
    targetGroupJids: params.targetGroupJids,
    reprocessed: false,
  };
}

/**
 * Serializa uma entrada da DLQ para o payload JSON armazenado no Redis.
 * Função PURO.
 */
export function serializeDlqItem(entry: MirrorDLQEntry): string {
  return JSON.stringify(entry);
}

/**
 * Parser tolerante de um item da DLQ a partir do payload JSON cru.
 *
 * Retorna `null` quando o JSON é inválido ou quando o objeto não possui
 * os campos obrigatórios mínimos (`id` e `event`) — esses itens são
 * considerados corruptos e devem ser ignorados pelo caller.
 *
 * Campos ausentes são preenchidos com defaults seguros:
 *   - `reprocessed` → false
 *   - `failureReason` / `lastError` / `attempts` → ''
 *   - `failedAt` → '' (ISO vazio)
 *   - `marketplace` / `originalUrl` / `conversionSuccess` / `targetGroupJids`
 *     → undefined (opcionais)
 *
 * Função PURO.
 */
export function parseDlqItem(raw: RawDLQItem): MirrorDLQEntry | null {
  let parsed: Partial<MirrorDLQEntry>;
  try {
    parsed = JSON.parse(raw) as Partial<MirrorDLQEntry>;
  } catch {
    // JSON malformado → item corrupto
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.id !== 'string' || parsed.id.length === 0) return null;
  if (!parsed.event || typeof parsed.event !== 'object') return null;

  return {
    id: parsed.id,
    event: parsed.event,
    failureReason: parsed.failureReason ?? '',
    attempts: parsed.attempts ?? 0,
    lastError: parsed.lastError ?? '',
    failedAt: parsed.failedAt ?? '',
    marketplace: parsed.marketplace,
    originalUrl: parsed.originalUrl,
    conversionSuccess: parsed.conversionSuccess,
    targetGroupJids: parsed.targetGroupJids,
    reprocessed: parsed.reprocessed ?? false,
    reprocessedAt: parsed.reprocessedAt,
    reprocessResult: parsed.reprocessResult,
  };
}

/**
 * Determina a fila de origem ('A' = Ingestor / RawMessageEvent,
 * 'B' = Dispatcher / SendEvent) a partir do evento.
 */
export function dlqItemQueue(entry: MirrorDLQEntry): 'A' | 'B' {
  const isRawEvent = 'messageId' in entry.event;
  return isRawEvent ? 'A' : 'B';
}

/**
 * Aplica os filtros in-memory (failureReason / queue / since) a uma lista
 * de entradas já ordenada (mais nova → mais velha). Usado por `listDLQ`.
 *
 * - `failureReason`: match exato (case-sensitive) contra `entry.failureReason`.
 * - `queue`: 'A' ou 'B' (vide {@link dlqItemQueue}).
 * - `since`: mantém apenas entradas com `failedAt` (ISO) >= since (ms epoch).
 *   Quando `failedAt` é vazio/inválido, o item NÃO passa no filtro `since`.
 *
 * Função PURO — não altera o array original (retorna novo array).
 */
export function filterDlqItems(
  entries: MirrorDLQEntry[],
  filters: { failureReason?: string; queue?: 'A' | 'B'; since?: number } = {},
): MirrorDLQEntry[] {
  const { failureReason, queue, since } = filters;
  return entries.filter((entry) => {
    if (failureReason && entry.failureReason !== failureReason) return false;
    if (queue && dlqItemQueue(entry) !== queue) return false;
    if (since != null) {
      const ts = Date.parse(entry.failedAt);
      if (Number.isNaN(ts) || ts < since) return false;
    }
    return true;
  });
}

// ─── Conexão Redis (lazy singleton) ──────────────────────────────────

let redis: Redis | null = null;
let dlqEnabled = true;

function getDLQRedis(): Redis | null {
  if (!dlqEnabled) return null;
  if (redis) return redis;

  try {
    redis = new Redis(config.REDIS_URL, {
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

const log = makeLogger('mirror-dlq');

// ─── API pública ──────────────────────────────────────────────────────

export async function pushToDLQ(params: DLQPushParams): Promise<void> {
  const r = getDLQRedis();
  if (!r) {
    log('warn', 'Redis não disponível — DLQ ignorada');
    return;
  }

  try {
    const entry = buildDlqEntry(params);
    const id = entry.id;
    const score = Date.now();
    const pipeline = r.pipeline();
    pipeline.rpush(MIRROR_DLQ_LIST, serializeDlqItem(entry));
    pipeline.zadd(MIRROR_DLQ_INDEX, score, id);
    await pipeline.exec();

    log('info', 'Item adicionado à Dead Letter Queue', {
      dlqId: id,
      messageId:
        'messageId' in params.event ? params.event.messageId : params.event.sourceMessageId,
      failureReason: params.failureReason,
      attempts: params.attempts,
      marketplace: params.marketplace,
    });
  } catch (err) {
    log('error', 'Falha ao adicionar item à DLQ', {
      error: err instanceof Error ? err.message : String(err),
      messageId:
        'messageId' in params.event ? params.event.messageId : params.event.sourceMessageId,
    });
  }
}

export async function listDLQ(options: DLQListOptions = {}): Promise<DLQListResult> {
  const emptyResult: DLQListResult = {
    items: [],
    total: 0,
    offset: options.offset ?? 0,
    limit: options.limit ?? 20,
    totalFiltered: 0,
  };

  const r = getDLQRedis();
  if (!r) return emptyResult;

  try {
    // Total global da DLQ — sempre reflete o zcard, sem filtros.
    const total = await r.zcard(MIRROR_DLQ_INDEX);

    const offset = options.offset ?? 0;
    const limit = options.limit ?? 20;
    const since = options.since;
    const failureReason = options.failureReason;
    const queue = options.queue;

    // 1) Pega IDs do ZSET, do mais novo pro mais velho.
    //    Se since foi passado, usa ZREVRANGEBYSCORE pra cortar no Redis;
    //    sem since, ZREVRANGE traz o ZSET inteiro (a DLQ tem <= alguns
    //    milhares de items; tamanho de payload pequeno, OK pra memória).
    //    O "limit" do ZREVRANGE existe só como salvaguarda — com since
    //    o score já limita, sem since queremos o conjunto todo pra
    //    que totalFiltered reflita a realidade após filtros in-memory.
    const fetchLimit = resolveDlqFetchLimit(since, offset, limit);
    const ids: string[] =
      since != null
        ? await r.zrevrangebyscore(MIRROR_DLQ_INDEX, '+inf', since, 'LIMIT', 0, fetchLimit)
        : await r.zrevrange(MIRROR_DLQ_INDEX, 0, fetchLimit - 1);
    if (ids.length === 0) {
      return { ...emptyResult, total, totalFiltered: 0 };
    }

    // 2) Carrega o conteúdo completo. lrange em batch único é mais simples
    //    que HMGET e a DLQ é pequena (até alguns milhares).
    const rawItems = await r.lrange(MIRROR_DLQ_LIST, 0, -1);
    const itemMap = new Map<string, MirrorDLQEntry>();
    for (const raw of rawItems) {
      const parsed = parseDlqItem(raw);
      if (parsed) itemMap.set(parsed.id, parsed);
    }

    // 3) Monta a lista na ordem dos IDs (mais novo → mais velho),
    //    aplicando filtros in-memory. totalFiltered conta quantos
    //    passaram pelos filtros — diferente de `total` (zcard global).
    const ordered: MirrorDLQEntry[] = ids
      .map((id) => itemMap.get(id))
      .filter((item): item is MirrorDLQEntry => item != null);

    const filtered = filterDlqItems(ordered, { failureReason, queue, since });

    const totalFiltered = filtered.length;
    const sliced = sliceDlqPage(filtered, offset, limit);

    return {
      items: sliced,
      total,
      offset,
      limit,
      totalFiltered,
    };
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
      const parsed = parseDlqItem(raw);
      if (parsed?.id === itemId) return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export async function requeueFromDLQ(itemId: string, targetStream: string): Promise<boolean> {
  const r = getDLQRedis();
  if (!r) return false;

  try {
    const item = await getDLQItem(itemId);
    if (!item) {
      log('warn', 'Item não encontrado na DLQ para re-processamento', { dlqId: itemId });
      return false;
    }

    await r.xadd(targetStream, '*', 'payload', JSON.stringify(item.event));

    const updatedEntry = buildReprocessedEntry(item);

    const pipeline = r.pipeline();
    const oldRaw = serializeDlqItem(item);
    pipeline.lrem(MIRROR_DLQ_LIST, 1, oldRaw);
    pipeline.rpush(MIRROR_DLQ_LIST, serializeDlqItem(updatedEntry));
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
    pipeline.lrem(MIRROR_DLQ_LIST, 1, serializeDlqItem(item));
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
      const parsed = parseDlqItem(raw);
      if (parsed && oldIdSet.has(parsed.id)) {
        pipeline.lrem(MIRROR_DLQ_LIST, 1, raw);
        pipeline.zrem(MIRROR_DLQ_INDEX, parsed.id);
        removed++;
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
