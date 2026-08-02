import { describe, it, expect } from 'bun:test';
import {
  aggregateMetrics,
  evaluateSlo,
  observationWindow,
  percentile,
  statusClass,
  type RequestRecord,
  type SLO,
} from './metrics-pure.ts';

function rec(startedAt: number, durationMs: number, status: number, error?: string): RequestRecord {
  return { startedAt, durationMs, status, error };
}

describe('statusClass', () => {
  it('classifica 2xx/3xx/4xx/5xx', () => {
    expect(statusClass(200)).toBe('2xx');
    expect(statusClass(302)).toBe('3xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
  });
  it('classifica 1xx', () => {
    expect(statusClass(101)).toBe('1xx');
  });
  it('classifica 0 e negativo como erro de transporte', () => {
    expect(statusClass(0)).toBe('error');
    expect(statusClass(-1)).toBe('error');
  });
});

describe('percentile', () => {
  it('retorna 0 para array vazio', () => {
    expect(percentile([], 95)).toBe(0);
  });
  it('retorna o próprio valor para lista unitária', () => {
    expect(percentile([5], 99)).toBe(5);
  });
  it('calcula p50 exato em lista ímpar', () => {
    expect(percentile([1, 2, 3], 50)).toBe(2);
  });
  it('interpola linearmente entre dois valores', () => {
    // rank = 0.95 * 3 = 2.85 -> entre idx 2 (3) e idx 3 (4): 3 + (4-3)*0.85
    expect(percentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85, 5);
  });
  it('não altera o array de entrada', () => {
    const input = [4, 1, 3, 2];
    const copy = [...input];
    percentile(input, 50);
    expect(input).toEqual(copy);
  });
});

describe('observationWindow', () => {
  it('retorna 0 para vazio', () => {
    expect(observationWindow([])).toBe(0);
  });
  it('usa ultimo fim menos primeiro inicio', () => {
    const recs = [rec(1000, 200, 200), rec(1500, 500, 200)];
    // fim maximo = 1500+500=2000; inicio minimo = 1000 -> 1000
    expect(observationWindow(recs)).toBe(1000);
  });
});

describe('aggregateMetrics', () => {
  it('agrega vazio como zero', () => {
    const s = aggregateMetrics([]);
    expect(s.total).toBe(0);
    expect(s.errors).toBe(0);
    expect(s.rps).toBe(0);
    expect(s.latency.p95).toBe(0);
  });
  it('contabiliza breakdown de status e erros', () => {
    const recs = [
      rec(0, 10, 200),
      rec(0, 20, 200),
      rec(0, 30, 404),
      rec(0, 5, 503),
      rec(0, 1, 0, 'timeout'),
    ];
    const s = aggregateMetrics(recs);
    expect(s.total).toBe(5);
    expect(s.status['2xx']).toBe(2);
    expect(s.status['4xx']).toBe(1);
    expect(s.status['5xx']).toBe(1);
    expect(s.status.error).toBe(1);
    expect(s.errors).toBe(1);
  });
  it('calcula rps sobre a janela', () => {
    // 10 requisições em 1s (1000ms) -> 10 rps
    const recs = Array.from({ length: 10 }, (_, i) => rec(i * 100, 50, 200));
    const s = aggregateMetrics(recs);
    expect(s.windowMs).toBe(950); // ultimo fim 9*100+50=950 - primeiro 0
    expect(s.rps).toBeCloseTo(10 / 0.95, 2);
  });
  it('calcula min/max/mean e percentis', () => {
    const recs = [rec(0, 10, 200), rec(0, 20, 200), rec(0, 30, 200)];
    const s = aggregateMetrics(recs);
    expect(s.latency.min).toBe(10);
    expect(s.latency.max).toBe(30);
    expect(s.latency.mean).toBe(20);
    expect(s.latency.p50).toBe(20);
  });
});

describe('evaluateSlo', () => {
  const baseSlo: SLO = {
    maxP95Ms: 200,
    maxP99Ms: 400,
    maxErrorRate: 0.01,
    max5xxRate: 0.005,
    minRps: 50,
  };
  const good = aggregateMetrics(Array.from({ length: 100 }, (_, i) => rec(i * 10, 50, 200)));
  const bad = aggregateMetrics([
    ...Array.from({ length: 90 }, (_, i) => rec(i * 10, 50, 200)),
    ...Array.from({ length: 10 }, (_, i) => rec(900 + i * 10, 5000, 503)),
  ]);

  it('passa quando todos os critérios são atendidos', () => {
    const r = evaluateSlo(good, baseSlo);
    expect(r.passed).toBe(true);
    expect(r.failures).toEqual([]);
  });
  it('lista cada falha de criterio', () => {
    const r = evaluateSlo(bad, baseSlo);
    expect(r.passed).toBe(false);
    expect(r.failures.length).toBeGreaterThanOrEqual(2);
    expect(r.failures.some((f) => f.includes('p95'))).toBe(true);
    expect(r.failures.some((f) => f.includes('5xx'))).toBe(true);
  });
  it('nao avalia taxa quando n=0', () => {
    const r = evaluateSlo(aggregateMetrics([]), { maxErrorRate: 0.0001 });
    expect(r.passed).toBe(true);
  });
  it('falha por rps abaixo do minimo', () => {
    const r = evaluateSlo(good, { minRps: 100000 });
    expect(r.passed).toBe(false);
    expect(r.failures.some((f) => f.includes('rps'))).toBe(true);
  });
});
