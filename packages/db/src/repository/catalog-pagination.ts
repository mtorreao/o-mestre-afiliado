/**
 * Lógica PURA de paginação do catálogo de produtos.
 *
 * Mesmas regras do `mirror-pagination.ts` (page >= 1, pageSize entre 1 e 100,
 * offset = (page-1) * pageSize). Mantida em arquivo próprio para isolar
 * cobertura >= 80% em código de negócio passível de teste.
 */

export const CATALOG_MAX_PAGE_SIZE = 100;
export const CATALOG_DEFAULT_PAGE_SIZE = 25;

export interface CatalogNormalizedPagination {
  page: number;
  pageSize: number;
  offset: number;
}

export function normalizeCatalogPagination(
  page: number | undefined,
  pageSize: number | undefined,
): CatalogNormalizedPagination {
  // isNaN guard: parseInt('abc') -> NaN cairia em offset NaN na query
  const p = Number.isNaN(page) ? 1 : Math.max(1, page ?? 1);
  const size = Number.isNaN(pageSize)
    ? CATALOG_DEFAULT_PAGE_SIZE
    : Math.min(CATALOG_MAX_PAGE_SIZE, Math.max(1, pageSize ?? CATALOG_DEFAULT_PAGE_SIZE));
  return {
    page: p,
    pageSize: size,
    offset: (p - 1) * size,
  };
}

/**
 * Normaliza o filtro de intervalo de datas (from/to) para o histórico.
 *  - `from` e `to` são strings ISO (`YYYY-MM-DD` ou ISO 8601 completo).
 *  - Strings inválidas -> `null` (sem filtro).
 *  - `from > to` -> swap silencioso (não trava a query).
 *
 * Retorna `Date | null` -- o repositório usa `gte()`/`lte()` direto.
 */
export function parseCatalogDateRange(
  from: string | undefined,
  to: string | undefined,
): { fromDate: Date | null; toDate: Date | null } {
  const fromDate = parseCatalogDate(from);
  const toDateRaw = parseCatalogDate(to);
  if (fromDate && toDateRaw && fromDate.getTime() > toDateRaw.getTime()) {
    return { fromDate: toDateRaw, toDate: fromDate };
  }
  return { fromDate, toDate: toDateRaw };
}

function parseCatalogDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}
