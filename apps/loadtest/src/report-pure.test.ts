import { describe, it, expect } from 'bun:test';
import { renderReport } from './report-pure.ts';
import { aggregateMetrics, evaluateSlo, type RequestRecord } from './metrics-pure.ts';

function rec(startedAt: number, durationMs: number, status: number): RequestRecord {
  return { startedAt, durationMs, status };
}

describe('renderReport', () => {
  it('inclui metricas principais', () => {
    const summary = aggregateMetrics([rec(0, 10, 200), rec(10, 20, 200)]);
    const out = renderReport('Teste', summary, null);
    expect(out).toContain('Total de reqs');
    expect(out).toContain('Throughput');
    expect(out).toContain('2xx');
  });
  it('marca SLO aprovado', () => {
    const summary = aggregateMetrics([rec(0, 10, 200)]);
    const slo = evaluateSlo(summary, { maxP95Ms: 1000 });
    const out = renderReport('T', summary, slo);
    expect(out).toContain('SLO APROVADO');
  });
  it('lista falhas de SLO', () => {
    const summary = aggregateMetrics([rec(0, 5000, 503)]);
    const slo = evaluateSlo(summary, { maxP95Ms: 100 });
    const out = renderReport('T', summary, slo);
    expect(out).toContain('SLO REPROVADO');
    expect(out).toContain('p95');
  });
});
