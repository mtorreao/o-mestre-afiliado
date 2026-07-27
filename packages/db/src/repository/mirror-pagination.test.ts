/**
 * Testes das funções PURAS de paginação de espelhamentos.
 */
import { describe, expect, it } from 'bun:test';
import {
  normalizePagination,
  computeTotalPages,
  MAX_PAGE_SIZE,
  DEFAULT_PAGE_SIZE,
} from './mirror-pagination.ts';

describe('normalizePagination', () => {
  it('usa defaults quando undefined', () => {
    const p = normalizePagination(undefined, undefined);
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(p.offset).toBe(0);
  });

  it('page mínimo é 1 (mesmo se negativo/zero)', () => {
    expect(normalizePagination(0, 10).page).toBe(1);
    expect(normalizePagination(-5, 10).page).toBe(1);
  });

  it('calcula offset = (page-1) * pageSize', () => {
    const p = normalizePagination(3, 25);
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(25);
    expect(p.offset).toBe(50);
  });

  it('pageSize máximo é MAX_PAGE_SIZE (100)', () => {
    expect(normalizePagination(1, 9999).pageSize).toBe(MAX_PAGE_SIZE);
    expect(normalizePagination(1, 9999).offset).toBe(0);
  });

  it('pageSize mínimo é 1', () => {
    expect(normalizePagination(2, 0).pageSize).toBe(1);
    expect(normalizePagination(2, -3).pageSize).toBe(1);
    expect(normalizePagination(2, 0).offset).toBe(1);
  });

  it('page e pageSize explícitos válidos são preservados', () => {
    const p = normalizePagination(5, 50);
    expect(p).toEqual({ page: 5, pageSize: 50, offset: 200 });
  });
});

describe('computeTotalPages', () => {
  it('retorna 1 quando vazio', () => {
    expect(computeTotalPages(0, 25)).toBe(1);
  });

  it('calcula teto de total/pageSize', () => {
    expect(computeTotalPages(100, 25)).toBe(4);
    expect(computeTotalPages(101, 25)).toBe(5);
    expect(computeTotalPages(25, 25)).toBe(1);
  });

  it('retorna 1 quando pageSize inválido (<=0)', () => {
    expect(computeTotalPages(50, 0)).toBe(1);
    expect(computeTotalPages(50, -1)).toBe(1);
  });

  it('sempre pelo menos 1 página', () => {
    expect(computeTotalPages(0, 1)).toBe(1);
  });
});
