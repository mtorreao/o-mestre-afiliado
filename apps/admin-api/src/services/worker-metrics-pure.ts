/**
 * Lógica PURA do agregador de métricas do worker (worker-metrics).
 *
 * Espelho de apps/api/src/services/worker-metrics-pure.ts — manter em sincronia.
 * Mantida como cópia local porque o admin-api roda isolado no VPS e ainda
 * não há workspace package compartilhado entre apps. Cópia é válida: ambos
 * rodam o mesmo contrato (listDlqItems, requeueDlqItem, etc.).
 *
 * Separa a montagem de headers de auth, normalização de filtros da DLQ
 * e a inferência do stream de requeue da camada de I/O (fetch/Redis).
 */
import { MIRROR_RAW_STREAM, MIRROR_SEND_STREAM } from '@omestre/shared';

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

/** Headers de autenticação para os metrics-servers (vazio sem API key). */
export function buildMetricsAuthHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { 'x-api-key': apiKey } : {};
}

/**
 * Normaliza a assinatura legada (offset, limit) e a nova (filters)
 * num único objeto de filtros.
 */
export function normalizeDlqFilters(
  offsetOrFilters: number | ListDlqFilters,
  legacyLimit: number = 20,
): ListDlqFilters {
  if (typeof offsetOrFilters === 'number') {
    return { offset: offsetOrFilters, limit: legacyLimit };
  }
  return offsetOrFilters;
}

/** True se algum filtro server-side está presente. */
export function hasServerSideFilter(filters: ListDlqFilters): boolean {
  return Boolean(filters.queue || filters.failureReason || filters.since != null);
}

/**
 * Limit efetivo da listagem da DLQ:
 *  - sem filtro: limit informado ou 20
 *  - com filtro: max(limit, 100) — a UI precisa de amostra suficiente
 *    para contagens significativas.
 */
export function computeEffectiveDlqLimit(filters: ListDlqFilters): number {
  const hasFilter = hasServerSideFilter(filters);
  return hasFilter ? Math.max(filters.limit ?? 100, 100) : (filters.limit ?? 20);
}

/**
 * Infere o stream de destino do requeue pelo shape do evento:
 *  - RawMessageEvent (tem `messageId`) → Queue A (Ingestor reprocessa)
 *  - SendEvent (tem `sourceMessageId`) → Queue B (Dispatcher reenvia)
 */
export function inferRequeueTargetStream(event: object): string {
  return 'messageId' in event ? MIRROR_RAW_STREAM : MIRROR_SEND_STREAM;
}
