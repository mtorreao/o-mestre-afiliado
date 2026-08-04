import { describe, it, expect } from 'bun:test';
import { renderRampReport } from './ramp-report-pure.ts';
import { analyzeRamp, type StageResult } from './ramp-pure.ts';
import { aggregateMetrics, type RequestRecord } from './metrics-pure.ts';

function rec(startedAt: number, durationMs: number, status: number): RequestRecord {
  return { startedAt, durationMs, status };
}

function stage(n: number, c: number, rps: number, p95: number): StageResult {
  const summary = aggregateMetrics([rec(0, 50, 200), rec(1, 50, 200)]);
  summary.rps = rps;
  summary.latency.p95 = p95;
  summary.total = 200;
  summary.status['2xx'] = 200;
  return { stage: n, concurrency: c, summary, slo: { passed: true, failures: [] } };
}

describe('renderRampReport', () => {
  it('inclui cabecalho de estagios', () => {
    const stages = [stage(1, 5, 100, 50), stage(2, 10, 190, 60)];
    const a = analyzeRamp(stages);
    const out = renderRampReport('demo', stages, a);
    expect(out).toContain('RAMP-UP: demo');
    expect(out).toContain('conc');
    expect(out).toContain('rps');
  });
  it('mostra saturacao quando presente', () => {
    const stages = [stage(1, 5, 100, 50), stage(2, 10, 105, 80)];
    const a = analyzeRamp(stages);
    const out = renderRampReport('demo', stages, a);
    expect(out).toContain('Saturacao detectada');
    expect(out).toContain('Capacidade estimada');
  });
});
