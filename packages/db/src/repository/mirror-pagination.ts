/**
 * Lógica PURA de paginação/listagem do repositório de espelhamentos.
 *
 * Separa a normalização de página/tamanho e o cálculo de total de páginas
 * (que não dependem de DB) das operações de I/O.
 */
export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export interface NormalizedPagination {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * Normaliza page/pageSize aplicando limites:
 *  - page: mínimo 1
 *  - pageSize: entre 1 e MAX_PAGE_SIZE (default DEFAULT_PAGE_SIZE)
 *  - offset: (page - 1) * pageSize
 */
export function normalizePagination(
  page: number | undefined,
  pageSize: number | undefined,
): NormalizedPagination {
  const p = Math.max(1, page ?? 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize ?? DEFAULT_PAGE_SIZE));
  return {
    page: p,
    pageSize: size,
    offset: (p - 1) * size,
  };
}

/**
 * Calcula o total de páginas a partir do total de registros e do pageSize.
 * Retorna pelo menos 1 (mesmo se vazio).
 */
export function computeTotalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}
