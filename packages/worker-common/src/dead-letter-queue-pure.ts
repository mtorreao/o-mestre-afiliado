/**
 * Lógica PURA adicional da Dead Letter Queue (dead-letter-queue.ts).
 *
 * Complementa as funções já extraídas (buildDlqEntry / serializeDlqItem /
 * parseDlqItem / dlqItemQueue / filterDlqItems) com a parte de LÓGICA de
 * decisão que ainda vivia inline nos callers de I/O (`listDLQ`,
 * `requeueFromDLQ`):
 *   - resolveDlqFetchLimit: decide quantos IDs buscar no ZSET dado o filtro
 *     `since` (salvaguarda anti-estouro de memória).
 *   - buildReprocessedEntry: monta a entrada atualizada (reprocessed=true) a
 *     partir da original — puro, determinístico dado o `now`.
 *   - sliceDlqPage: aplica offset/limit à lista já filtrada (mesma semântica
 *     de `Array.prototype.slice`).
 *
 * Todas as funções são síncronas e 100% testáveis sem Redis.
 */
import type { MirrorDLQEntry } from '@omestre/shared';

/** Parâmetros de listagem relevantes para a lógica pura. */
export interface DlqQueryParams {
  offset?: number;
  limit?: number;
  /** Filtra por failureReason (match exato). */
  failureReason?: string;
  /** Filtra por fila de origem: 'A' (Ingestor) ou 'B' (Dispatcher). */
  queue?: 'A' | 'B';
  /** Filtra items com failedAt >= since (ms epoch). */
  since?: number;
}

/**
 * Decide quantos IDs buscar no ZSET antes de filtrar em memória.
 *
 * Sem `since`, trazemos o ZSET inteiro (a DLQ é pequena, <= alguns milhares),
 * pois o `totalFiltered` precisa refletir a realidade após os filtros
 * in-memory — usa-se um teto alto (100_000) como salvaguarda.
 *
 * Com `since`, usamos ZREVRANGEBYSCORE que já corta por score; aqui só
 * adicionamos folga para não perder itens que casariam nos filtros
 * in-memory (failureReason/queue) mas estivessem fora da janela estrita.
 *
 * Função PURO.
 */
export function resolveDlqFetchLimit(
  since: number | undefined,
  offset: number,
  limit: number,
): number {
  if (since != null) {
    return (offset + limit) * 10 + 100;
  }
  return 100_000;
}

/**
 * Constrói a entrada atualizada para re-processamento.
 *
 * Marca `reprocessed = true`, preenche `reprocessedAt` (agora) e
 * `reprocessResult`. O caller (requeueFromDLQ) persiste essa entrada
 * atualizada no Redis — esta função só monta o objeto.
 *
 * Função PURO (recebe `now` injetável p/ teste determinístico).
 */
export function buildReprocessedEntry(
  item: MirrorDLQEntry,
  now: () => string = () => new Date().toISOString(),
): MirrorDLQEntry {
  return {
    ...item,
    reprocessed: true,
    reprocessedAt: now(),
    reprocessResult: 're-enfileirado no stream',
  };
}

/**
 * Aplica paginação (offset/limit) à lista já filtrada.
 *
 * Espelha exatamente `filtered.slice(offset, offset + limit)`. Extraída
 * para isolar a lógica de paginação da chamada de I/O (lrange + map +
 * filter) em `listDLQ`.
 *
 * Função PURO — não altera o array original.
 */
export function sliceDlqPage(
  filtered: MirrorDLQEntry[],
  offset: number,
  limit: number,
): MirrorDLQEntry[] {
  return filtered.slice(offset, offset + limit);
}
