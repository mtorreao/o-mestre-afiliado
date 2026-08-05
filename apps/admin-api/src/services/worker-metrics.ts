/**
 * Agregador de métricas dos processadores do worker (Ingestor + Dispatcher)
 * e operações diretas na Dead Letter Queue compartilhada.
 *
 * Espelho de apps/api/src/services/worker-metrics.ts — diferença principal:
 *   - Usa Hono no admin-api em vez de Elysia.
 *   - Não usa `config` lazy do @omestre/shared, recebe config explícita
 *     via parâmetro (loadConfig do admin-api retorna object congelado).
 *   - Operamos direto no PG (omitindo `getDb()` singleton de @omestre/db)
 *     porque esta stack ainda não importa o pool — o admin-api só consome
 *     o Redis e o metrics HTTP, não o banco diretamente.
 *
 * A API faz proxy dos servidores de métricas individuais (porta 9092/9093)
 * para o /status, e opera na DLQ diretamente via @omestre/worker-common
 * (a DLQ é compartilhada no Redis — não depende de nenhum serviço estar up).
 */
import { MIRROR_RAW_STREAM, MIRROR_SEND_STREAM } from '@omestre/shared';
import type { MirrorDLQEntry } from '@omestre/shared';
import {
  listDLQ as dlqList,
  getDLQItem,
  requeueFromDLQ,
  removeFromDLQ,
  purgeOldDLQItems,
} from '@omestre/worker-common';
import { getFlagRedis } from '@omestre/feature-flags-sdk';
import type { AdminConfig } from '../config.ts';
import {
  buildMetricsAuthHeaders,
  computeEffectiveDlqLimit,
  inferRequeueTargetStream,
  normalizeDlqFilters,
} from './worker-metrics-pure.ts';
import type { ListDlqFilters } from './worker-metrics-pure.ts';

export type { ListDlqFilters } from './worker-metrics-pure.ts';

export type WorkerServiceName = 'ingestor' | 'dispatcher';

export interface WorkerMetricsDeps {
  config: AdminConfig;
}

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

function authHeaders(apiKey: string): Record<string, string> {
  return buildMetricsAuthHeaders(apiKey);
}

async function fetchServiceStatus(
  name: WorkerServiceName,
  url: string,
  apiKey: string,
): Promise<ServiceStatus> {
  try {
    const res = await fetch(`${url}/status`, {
      signal: AbortSignal.timeout(5000),
      headers: authHeaders(apiKey),
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

async function streamLength(stream: string, redisUrl: string): Promise<number | null> {
  const r = getFlagRedis(redisUrl);
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
export async function getAggregatedWorkerStatus(
  deps: WorkerMetricsDeps,
): Promise<AggregatedWorkerStatus> {
  const { config } = deps;
  const [ingestor, dispatcher, queueA, queueB] = await Promise.all([
    fetchServiceStatus('ingestor', config.workerMetricsUrl, config.metricsApiKey),
    fetchServiceStatus('dispatcher', config.dispatcherMetricsUrl, config.metricsApiKey),
    streamLength(MIRROR_RAW_STREAM, config.redisUrl),
    streamLength(MIRROR_SEND_STREAM, config.redisUrl),
  ]);

  return {
    success: true,
    services: [ingestor, dispatcher],
    pipeline: { queueA, queueB },
  };
}

// ─── DLQ — operações diretas na fila compartilhada ───────────────────────

/**
 * Aceita filtros server-side. Quando filtros são aplicados, aumentamos
 * o limit automaticamente (até 100) porque a UI precisa ver o suficiente
 * pra mostrar contagens significativas e não só 20 itens coincidentes.
 */
export async function listDlqItems(
  offsetOrFilters: number | ListDlqFilters = 0,
  legacyLimit: number = 20,
) {
  const filters = normalizeDlqFilters(offsetOrFilters, legacyLimit);
  const effectiveLimit = computeEffectiveDlqLimit(filters);

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
export async function requeueDlqItem(
  itemId: string,
): Promise<{ success: boolean; targetStream?: string }> {
  const item = await getDLQItem(itemId);
  if (!item) return { success: false };

  const event = item.event as MirrorDLQEntry['event'];
  const targetStream = inferRequeueTargetStream(event);
  const ok = await requeueFromDLQ(itemId, targetStream);
  return { success: ok, targetStream };
}

export async function removeDlqItem(itemId: string): Promise<boolean> {
  return await removeFromDLQ(itemId);
}

export async function purgeDlq(): Promise<number> {
  return await purgeOldDLQItems();
}
