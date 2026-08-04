/**
 * ramp-pure.ts — logica pura do modo ramp-up (cargas em estagios).
 *
 * Sem I/O: define o plano de estagios, analisa a saturacao comparando o
 * ganho de throughput entre estagios consecutivos e detecta violacao de SLO.
 */

import type { RunSummary, SloResult } from './metrics-pure.ts';

export interface StageConfig {
  /** numero de requisicoes em voo simultaneas neste estagio. */
  concurrency: number;
  /** duracao do estagio em ms. */
  durationMs: number;
}

export interface RampPlan {
  name: string;
  stages: StageConfig[];
}

export interface StageResult {
  /** 1-based. */
  stage: number;
  concurrency: number;
  summary: RunSummary;
  slo: SloResult | null;
}

export interface RampAnalysisOptions {
  /** ganho minimo de throughput (%) para considerar ainda escalando. */
  throughputDeltaPct?: number;
}

export interface RampAnalysis {
  /** 1-based estagio onde a saturacao foi detectada, ou null. */
  saturationStage: number | null;
  /** throughput (req/s) estimado como capacidade maxima sustentavel. */
  capacityRps: number;
  /** 1-based estagio onde o SLO foi rompido pela 1a vez, ou null. */
  breachedSloStage: number | null;
  reasons: string[];
}

/** Plano de ramp padrao para go-live (escala 5->100). */
export function defaultRampPlan(name: string): RampPlan {
  return {
    name,
    stages: [
      { concurrency: 5, durationMs: 10_000 },
      { concurrency: 10, durationMs: 10_000 },
      { concurrency: 25, durationMs: 15_000 },
      { concurrency: 50, durationMs: 15_000 },
      { concurrency: 100, durationMs: 20_000 },
    ],
  };
}

/**
 * Parsia spec "conc:seg,conc:seg" (ex: 5:10,25:15,100:20).
 * Retorna null se vazio ou malformado.
 */
export function parseStagesSpec(spec: string): StageConfig[] | null {
  const parts = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const stages: StageConfig[] = [];
  for (const p of parts) {
    const [c, d] = p.split(':');
    const concurrency = Number(c);
    const durationSec = Number(d ?? '10');
    if (!Number.isFinite(concurrency) || concurrency <= 0) return null;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
    stages.push({
      concurrency: Math.floor(concurrency),
      durationMs: Math.floor(durationSec * 1000),
    });
  }
  return stages;
}

/**
 * Analisa a saturacao: o sistema saturou quando aumentar a concorrencia
 * deixou de traduzir em ganho de throughput (ganho < delta%) AO MESMO TEMPO
 * em que a latencia p95 subiu. Tambem registra o 1o estagio com SLO rompido.
 */
export function analyzeRamp(stages: StageResult[], opts: RampAnalysisOptions = {}): RampAnalysis {
  const deltaPct = opts.throughputDeltaPct ?? 5;
  let saturationStage: number | null = null;
  let breachedSloStage: number | null = null;
  const reasons: string[] = [];

  for (let i = 0; i < stages.length; i++) {
    const cur = stages[i]!;
    if (cur.slo && !cur.slo.passed && breachedSloStage === null) {
      breachedSloStage = cur.stage;
    }

    if (i > 0 && saturationStage === null) {
      const prev = stages[i - 1]!;
      const prevRps = prev.summary.rps;
      const curRps = cur.summary.rps;
      const gainPct = prevRps > 0 ? ((curRps - prevRps) / prevRps) * 100 : 100;
      const latencyUp = cur.summary.latency.p95 > prev.summary.latency.p95;

      if (gainPct <= deltaPct && latencyUp) {
        saturationStage = cur.stage;
        reasons.push(
          'Estagio ' +
            cur.stage +
            ' (conc ' +
            cur.concurrency +
            '): throughput subiu so ' +
            gainPct.toFixed(1) +
            '% (' +
            prevRps.toFixed(0) +
            '->' +
            curRps.toFixed(0) +
            ' rps) enquanto p95 ' +
            prev.summary.latency.p95.toFixed(0) +
            '->' +
            cur.summary.latency.p95.toFixed(0) +
            'ms',
        );
      }
    }
  }

  let capacityRps = stages.length > 0 ? stages[stages.length - 1]!.summary.rps : 0;
  if (saturationStage !== null) {
    const idx = stages.findIndex((s) => s.stage === saturationStage);
    if (idx > 0) capacityRps = stages[idx - 1]!.summary.rps;
  }

  return { saturationStage, capacityRps, breachedSloStage, reasons };
}
