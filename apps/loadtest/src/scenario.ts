/**
 * scenario.ts — engine de execução de cenário de carga.
 *
 * Dispara N requisições com até `concurrency` em paralelo, registrando
 * latência/status de cada uma, e agrega via metrics-pure. Sem dependências
 * externas (usa fetch nativo do Bun).
 */

import {
  aggregateMetrics,
  evaluateSlo,
  type RequestRecord,
  type RunSummary,
  type SLO,
  type SloResult,
} from './metrics-pure.ts';

export interface ScenarioRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** ms de atraso antes de enviar (jitter). */
  delayMs?: number;
}

export interface ScenarioConfig {
  name: string;
  requests: ScenarioRequest[];
  concurrency: number;
  /** timeout por requisição (ms). */
  timeoutMs?: number;
  /** SLO opcional para avaliação. */
  slo?: SLO;
}

export interface ScenarioOutput {
  name: string;
  summary: RunSummary;
  slo: SloResult | null;
}

export async function sendOne(req: ScenarioRequest, timeoutMs: number): Promise<RequestRecord> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (req.delayMs && req.delayMs > 0) {
      await Bun.sleep(req.delayMs);
    }
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    return { startedAt, durationMs, status: res.status };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    return { startedAt, durationMs, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Executa o cenário respeitando a concorrência máxima (semestre-buffer).
 * Intercala requisições em lotes de `concurrency` em voo.
 */
export async function runScenario(cfg: ScenarioConfig): Promise<ScenarioOutput> {
  const timeoutMs = cfg.timeoutMs ?? 10_000;
  const records: RequestRecord[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= cfg.requests.length) return;
      const req = cfg.requests[idx]!;
      records.push(await sendOne(req, timeoutMs));
    }
  }

  const pool = Array.from({ length: cfg.concurrency }, () => worker());
  await Promise.all(pool);

  const summary = aggregateMetrics(records);
  const slo = cfg.slo ? evaluateSlo(summary, cfg.slo) : null;
  return { name: cfg.name, summary, slo };
}
