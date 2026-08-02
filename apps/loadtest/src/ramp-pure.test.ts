import { describe, it, expect } from 'bun:test';
import { analyzeRamp, defaultRampPlan, parseStagesSpec, type StageResult } from './ramp-pure.ts';
import { aggregateMetrics, type RequestRecord } from './metrics-pure.ts';

function rec(startedAt: number, durationMs: number, status: number): RequestRecord {
  return { startedAt, durationMs, status };
}

function stage(
  n: number,
  concurrency: number,
  rps: number,
  p95: number,
  sloPass: boolean,
): StageResult {
  // janela de 1s para o rps bater
  const total = Math.max(1, Math.round(rps));
  const records: RequestRecord[] = [];
  for (let i = 0; i < total; i++) records.push(rec(i * (1000 / total), 50, 200));
  const summary = aggregateMetrics(records);
  summary.rps = rps;
  summary.latency.p95 = p95;
  return {
    stage: n,
    concurrency,
    summary,
    slo: { passed: sloPass, failures: sloPass ? [] : ['p95'] },
  };
}

describe('defaultRampPlan', () => {
  it('tem 5 estagios crescentes', () => {
    const p = defaultRampPlan('x');
    expect(p.stages.length).toBe(5);
    expect(p.stages[0]!.concurrency).toBe(5);
    expect(p.stages[4]!.concurrency).toBe(100);
  });
});

describe('parseStagesSpec', () => {
  it('retorna null para vazio', () => {
    expect(parseStagesSpec('')).toBeNull();
  });
  it('faz parse de spec valida', () => {
    const s = parseStagesSpec('5:10,25:15,100:20');
    expect(s).not.toBeNull();
    expect(s!.length).toBe(3);
    expect(s![0]!.concurrency).toBe(5);
    expect(s![0]!.durationMs).toBe(10_000);
    expect(s![2]!.concurrency).toBe(100);
    expect(s![2]!.durationMs).toBe(20_000);
  });
  it('retorna null para concorrencia invalida', () => {
    expect(parseStagesSpec('0:10')).toBeNull();
    expect(parseStagesSpec('abc:10')).toBeNull();
  });
});

describe('analyzeRamp', () => {
  it('detecta saturacao quando ganho de rps cai e p95 sobe', () => {
    const stages = [
      stage(1, 5, 100, 50, true),
      stage(2, 10, 105, 80, true), // +5% rps, p95 subiu -> saturacao
    ];
    const a = analyzeRamp(stages);
    expect(a.saturationStage).toBe(2);
    expect(a.capacityRps).toBe(100);
  });
  it('nao detecta saturacao quando rps ainda cresce bem', () => {
    const stages = [
      stage(1, 5, 100, 50, true),
      stage(2, 10, 190, 60, true), // +90% rps, ainda escalando
    ];
    const a = analyzeRamp(stages);
    expect(a.saturationStage).toBeNull();
  });
  it('registra 1o estagio com SLO rompido', () => {
    const stages = [
      stage(1, 5, 100, 50, true),
      stage(2, 10, 190, 60, true),
      stage(3, 25, 195, 900, false), // SLO falha
    ];
    const a = analyzeRamp(stages);
    expect(a.breachedSloStage).toBe(3);
  });
  it('calcula capacidade como rps do ultimo estagio sem saturacao', () => {
    const stages = [stage(1, 5, 100, 50, true), stage(2, 10, 190, 60, true)];
    const a = analyzeRamp(stages);
    expect(a.saturationStage).toBeNull();
    expect(a.capacityRps).toBe(190);
  });
});
