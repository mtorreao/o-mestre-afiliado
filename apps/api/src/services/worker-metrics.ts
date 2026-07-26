/**
 * Agregador de métricas dos processadores do worker (Ingestor + Dispatcher)
 * e operações diretas na Dead Letter Queue compartilhada.
 *
 * A API faz proxy dos servidores de métricas individuais (porta 9092/9093)
 * para o /status, e opera na DLQ diretamente via @omestre/worker-common
 * (a DLQ é compartilhada no Redis — não depende de nenhum serviço estar up).
 */
import {
  MIRROR_RAW_STREAM,
  MIRROR_SEND_STREAM,
} from '@omestre/shared';
import type { MirrorDLQEntry } from '@omestre/shared';
import {
  listDLQ as dlqList,
  getDLQItem,
  requeueFromDLQ,
  removeFromDLQ,
  purgeOldDLQItems,
} from '@omestre/worker-common';
import { getRedis } from './redis.ts';

const INGESTOR_METRICS_URL =
  process.env.WORKER_METRICS_URL || 'http://localhost:9092';
const DISPATCHER_METRICS_URL =
  process.env.DISPATCHER_METRICS_URL || 'http://localhost:9093';
const METRICS_API_KEY = process.env.METRICS_API_KEY || '';

export type WorkerServiceName = 'ingestor' | 'dispatcher';

const SERVICE_URLS: Record<WorkerServiceName, string> = {
  ingestor: INGESTOR_METRICS_URL,
  dispatcher: DISPATCHER_METRICS_URL,
};

export interface ServiceStatus {
  name: WorkerServiceName;
  reachable: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface AggregatedWorkerStatus {
  success: boolean;
  services: ServiceStatus[];
  pipeline: {
    queueA: number | null;
    queueB: number | null;
  };
}

function authHeaders(): Record<string, string> {
  return METRICS_API_KEY ? { 'x-api-key': METRICS_API_KEY } : {};
}

async function fetchServiceStatus(name: WorkerServiceName): Promise<ServiceStatus> {
  const url = SERVICE_URLS[name];
  try {
    const res = await fetch(`${url}/status`, {
      signal: AbortSignal.timeout(5000),
      headers: authHeaders(),
    });
    if (!res.ok) {
      return { name, reachable: false, error: `HTTP ${res.status}` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { name, reachable: true, ...data };
  } catch (err) {
    return {
      name,
      reachable: false,
      error: err instanceof Error ? err.message : 'Falha ao contactar serviço',
    };
  }
}

async function streamLength(stream: string): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.xlen(stream);
  } catch {
    return null;
  }
}

/**
 * Consolida o status de Ingestor + Dispatcher (em paralelo) e a profundidade
 * das duas filas. Nunca lança — serviços inacessíveis viram `reachable:false`.
 */
export async function getAggregatedWorkerStatus(): Promise<AggregatedWorkerStatus> {
  const [ingestor, dispatcher, queueA, queueB] = await Promise.all([
    fetchServiceStatus('ingestor'),
    fetchServiceStatus('dispatcher'),
    streamLength(MIRROR_RAW_STREAM),
    streamLength(MIRROR_SEND_STREAM),
  ]);

  return {
    success: true,
    services: [ingestor, dispatcher],
    pipeline: { queueA, queueB },
  };
}

// ─── DLQ — operações diretas na fila compartilhada ───────────────────────

export interface ListDlqFilters {
  offset?: number;
  limit?: number;
  /** Filtro server-side. Aceita 'A' ou 'B'. */
  queue?: 'A' | 'B';
  /** Filtro server-side. Match exato em failureReason. */
  failureReason?: string;
  /** Filtro server-side. Epoch ms (Date.now()). */
  since?: number;
}

/**
 * Aceita filtros server-side. Quando filtros são aplicados, aumentamos
 * o limit automaticamente (até 100) porque a UI precisa ver o suficiente
 * pra mostrar contagens significativas e não só 20 itens coincidentes.
 */
export async function listDlqItems(
  offsetOrFilters: number | ListDlqFilters = 0,
  legacyLimit: number = 20,
) {
  // Back-compat: assinatura antiga (offset, limit) — usada internamente
  // se algum outro lugar chamar assim. A API HTTP usa a forma nova.
  let filters: ListDlqFilters;
  if (typeof offsetOrFilters === 'number') {
    filters = { offset: offsetOrFilters, limit: legacyLimit };
  } else {
    filters = offsetOrFilters;
  }

  const hasFilter = Boolean(filters.queue || filters.failureReason || filters.since != null);
  const effectiveLimit = hasFilter ? Math.max(filters.limit ?? 100, 100) : filters.limit ?? 20;

  return await dlqList({
    offset: filters.offset ?? 0,
    limit: effectiveLimit,
    queue: filters.queue,
    failureReason: filters.failureReason,
    since: filters.since,
  });
}

/**
 * Re-enfileira um item da DLQ no stream correto, inferido pelo tipo do evento:
 *   - RawMessageEvent (tem `messageId`) → Queue A (Ingestor reprocessa)
 *   - SendEvent (tem `sourceMessageId`) → Queue B (Dispatcher reenvia)
 */
export async function requeueDlqItem(itemId: string): Promise<{ success: boolean; targetStream?: string }> {
  const item = await getDLQItem(itemId);
  if (!item) return { success: false };

  const event = item.event as MirrorDLQEntry['event'];
  const targetStream = 'messageId' in event ? MIRROR_RAW_STREAM : MIRROR_SEND_STREAM;
  const ok = await requeueFromDLQ(itemId, targetStream);
  return { success: ok, targetStream };
}

export async function removeDlqItem(itemId: string): Promise<boolean> {
  return await removeFromDLQ(itemId);
}

export async function purgeDlq(): Promise<number> {
  return await purgeOldDLQItems();
}
