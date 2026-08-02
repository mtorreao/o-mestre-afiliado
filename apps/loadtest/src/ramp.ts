/**
 * ramp.ts — engine de execucao do modo ramp-up (I/O).
 *
 * Para cada estagio, dispara `concurrency` workers que ficam em loop
 * disparando requisicoes (via factory por indice) ate a duracao do estagio
 * expirar. Agrega por estagio e roda a analise de saturacao.
 */

import {
  aggregateMetrics,
  evaluateSlo,
  type RequestRecord,
  type SLO,
  type SloResult,
} from './metrics-pure.ts';
import { analyzeRamp, type RampAnalysis, type RampPlan, type StageResult } from './ramp-pure.ts';
import { sendOne, type ScenarioRequest } from './scenario.ts';

export interface RampRunOptions {
  factory: (index: number) => ScenarioRequest;
  timeoutMs?: number;
  slo?: SLO;
}

export interface RampOutput {
  name: string;
  stages: StageResult[];
  analysis: RampAnalysis;
}

export async function runRamp(plan: RampPlan, opts: RampRunOptions): Promise<RampOutput> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const stages: StageResult[] = [];
  let cursor = 0;

  for (let s = 0; s < plan.stages.length; s++) {
    const stageCfg = plan.stages[s]!;
    const records: RequestRecord[] = [];
    const stageStart = Date.now();

    const makeRequest = (): ScenarioRequest => opts.factory(cursor++);

    async function worker(): Promise<void> {
      while (Date.now() - stageStart < stageCfg.durationMs) {
        records.push(await sendOne(makeRequest(), timeoutMs));
      }
    }

    const pool = Array.from({ length: stageCfg.concurrency }, () => worker());
    await Promise.all(pool);

    const summary = aggregateMetrics(records);
    const slo: SloResult | null = opts.slo ? evaluateSlo(summary, opts.slo) : null;
    stages.push({ stage: s + 1, concurrency: stageCfg.concurrency, summary, slo });
  }

  const analysis = analyzeRamp(stages);
  return { name: plan.name, stages, analysis };
}
