/**
 * Testes das funções PURAS de paginação e parse de datas do catálogo.
 */
import { describe, expect, it } from 'bun:test';
import {
  normalizeCatalogPagination,
  parseCatalogDateRange,
  CATALOG_MAX_PAGE_SIZE,
  CATALOG_DEFAULT_PAGE_SIZE,
} from './catalog-pagination.ts';

describe('normalizeCatalogPagination', () => {
  it('usa defaults quando undefined', () => {
    const p = normalizeCatalogPagination(undefined, undefined);
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(CATALOG_DEFAULT_PAGE_SIZE);
    expect(p.offset).toBe(0);
  });

  it('page mínimo é 1', () => {
    expect(normalizeCatalogPagination(0, 10).page).toBe(1);
    expect(normalizeCatalogPagination(-5, 10).page).toBe(1);
  });

  it('calcula offset = (page-1) * pageSize', () => {
    const p = normalizeCatalogPagination(3, 25);
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(25);
    expect(p.offset).toBe(50);
  });

  it('pageSize máximo é CATALOG_MAX_PAGE_SIZE (100)', () => {
    expect(normalizeCatalogPagination(1, 9999).pageSize).toBe(CATALOG_MAX_PAGE_SIZE);
    expect(normalizeCatalogPagination(1, 9999).offset).toBe(0);
  });

  it('pageSize mínimo é 1', () => {
    expect(normalizeCatalogPagination(2, 0).pageSize).toBe(1);
    expect(normalizeCatalogPagination(2, -3).pageSize).toBe(1);
    expect(normalizeCatalogPagination(2, 0).offset).toBe(1);
  });

  it('NaN cai nos defaults (parseInt de query inválida)', () => {
    expect(normalizeCatalogPagination(Number.NaN, Number.NaN)).toEqual({
      page: 1,
      pageSize: CATALOG_DEFAULT_PAGE_SIZE,
      offset: 0,
    });
    expect(normalizeCatalogPagination(3, Number.NaN)).toEqual({
      page: 3,
      pageSize: CATALOG_DEFAULT_PAGE_SIZE,
      offset: 50,
    });
  });
});

describe('parseCatalogDateRange', () => {
  it('ambos undefined -> null/null', () => {
    expect(parseCatalogDateRange(undefined, undefined)).toEqual({
      fromDate: null,
      toDate: null,
    });
  });

  it('strings vazias -> null/null', () => {
    expect(parseCatalogDateRange('', '')).toEqual({ fromDate: null, toDate: null });
  });

  it('aceita ISO date YYYY-MM-DD', () => {
    const { fromDate, toDate } = parseCatalogDateRange('2026-01-01', '2026-01-31');
    expect(fromDate?.toISOString().startsWith('2026-01-01')).toBe(true);
    expect(toDate?.toISOString().startsWith('2026-01-31')).toBe(true);
  });

  it('aceita ISO 8601 completo', () => {
    const { fromDate } = parseCatalogDateRange('2026-01-15T10:30:00Z', undefined);
    expect(fromDate?.toISOString()).toBe('2026-01-15T10:30:00.000Z');
  });

  it('strings inválidas -> null', () => {
    expect(parseCatalogDateRange('not-a-date', 'also-bad')).toEqual({
      fromDate: null,
      toDate: null,
    });
  });

  it('inverte quando from > to', () => {
    const { fromDate, toDate } = parseCatalogDateRange('2026-12-31', '2026-01-01');
    expect(fromDate?.toISOString().startsWith('2026-01-01')).toBe(true);
    expect(toDate?.toISOString().startsWith('2026-12-31')).toBe(true);
  });

  it('mix válido/inválido: válido preservado, inválido null', () => {
    const { fromDate, toDate } = parseCatalogDateRange('2026-01-01', 'bad');
    expect(fromDate?.toISOString().startsWith('2026-01-01')).toBe(true);
    expect(toDate).toBeNull();
  });
});
