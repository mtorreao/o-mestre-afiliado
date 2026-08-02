/**
 * metrics-pure.ts — lógica pura de agregação de métricas de carga.
 *
 * Sem I/O: recebe registros de requisição e produz resumos, percentis e
 * avaliação de SLO. Isolado para cobertura unitária (~100%) sem rede.
 */

export type StatusClass = '1xx' | '2xx' | '3xx' | '4xx' | '5xx' | 'error';

export interface RequestRecord {
  /** ms epoch em que a requisição foi iniciada. */
  startedAt: number;
  /** duração total em ms (inclui connect + wait). */
  durationMs: number;
  /** status HTTP; 0 quando houve erro de rede/timeout (sem resposta). */
  status: number;
  /** erro de transporte (timeout, ECONNRESET, etc). Ausente em sucesso. */
  error?: string;
}

export interface StatusBreakdown {
  '1xx': number;
  '2xx': number;
  '3xx': number;
  '4xx': number;
  '5xx': number;
  error: number;
}

export interface LatencySummary {
  min: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

export interface RunSummary {
  total: number;
  errors: number;
  rps: number;
  /** janela de observação em ms (último fim - primeiro início). */
  windowMs: number;
  status: StatusBreakdown;
  latency: LatencySummary;
}

export interface SLO {
  /** latência p95 máxima aceitável em ms. */
  maxP95Ms?: number;
  /** latência p99 máxima aceitável em ms. */
  maxP99Ms?: number;
  /** máximo de erros de transporte (fração 0..1). */
  maxErrorRate?: number;
  /** máximo de respostas 5xx (fração 0..1). */
  max5xxRate?: number;
  /** mínimo de throughput sustentado (req/s). */
  minRps?: number;
}

export interface SloResult {
  passed: boolean;
  failures: string[];
}

/** Classifica um status HTTP (0 = erro de transporte). */
export function statusClass(status: number): StatusClass {
  if (status <= 0) return 'error';
  if (status < 200) return '1xx';
  if (status < 300) return '2xx';
  if (status < 400) return '3xx';
  if (status < 500) return '4xx';
  return '5xx';
}

/** Percentil linear-interpolado (p em 0..100). Array não é mutado. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] ?? 0;
  const frac = rank - lo;
  const low = sorted[lo] ?? 0;
  const high = sorted[hi] ?? 0;
  return low + (high - low) * frac;
}

/** Janela de observação: (último fim) - (primeiro início) em ms. */
export function observationWindow(records: RequestRecord[]): number {
  if (records.length === 0) return 0;
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const r of records) {
    if (r.startedAt < minStart) minStart = r.startedAt;
    const end = r.startedAt + r.durationMs;
    if (end > maxEnd) maxEnd = end;
  }
  return Math.max(0, maxEnd - minStart);
}

function emptyBreakdown(): StatusBreakdown {
  return { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, error: 0 };
}

/** Agrega uma lista de registros em um RunSummary. */
export function aggregateMetrics(records: RequestRecord[]): RunSummary {
  const status = emptyBreakdown();
  const latencies: number[] = [];
  let errors = 0;

  for (const r of records) {
    const cls = statusClass(r.status);
    status[cls] += 1;
    if (cls === 'error') errors += 1;
    latencies.push(r.durationMs);
  }

  const windowMs = observationWindow(records);
  const windowSec = windowMs > 0 ? windowMs / 1000 : 0;
  const rps = windowSec > 0 ? records.length / windowSec : 0;

  const mean =
    latencies.length > 0 ? latencies.reduce((acc, v) => acc + v, 0) / latencies.length : 0;

  const latency: LatencySummary = {
    min: latencies.length > 0 ? Math.min(...latencies) : 0,
    p50: percentile(latencies, 50),
    p90: percentile(latencies, 90),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.length > 0 ? Math.max(...latencies) : 0,
    mean,
  };

  return {
    total: records.length,
    errors,
    rps,
    windowMs,
    status,
    latency,
  };
}

/** Avalia um RunSummary contra um SLO, retornando falhas por critério. */
export function evaluateSlo(summary: RunSummary, slo: SLO): SloResult {
  const failures: string[] = [];
  const n = summary.total;

  if (slo.maxP95Ms !== undefined && summary.latency.p95 > slo.maxP95Ms) {
    failures.push(`p95 ${summary.latency.p95.toFixed(0)}ms > limite ${slo.maxP95Ms}ms`);
  }
  if (slo.maxP99Ms !== undefined && summary.latency.p99 > slo.maxP99Ms) {
    failures.push(`p99 ${summary.latency.p99.toFixed(0)}ms > limite ${slo.maxP99Ms}ms`);
  }
  if (slo.maxErrorRate !== undefined && n > 0) {
    const rate = summary.errors / n;
    if (rate > slo.maxErrorRate) {
      failures.push(
        `erros ${(rate * 100).toFixed(2)}% > limite ${(slo.maxErrorRate * 100).toFixed(2)}%`,
      );
    }
  }
  if (slo.max5xxRate !== undefined && n > 0) {
    const rate = summary.status['5xx'] / n;
    if (rate > slo.max5xxRate) {
      failures.push(
        `5xx ${(rate * 100).toFixed(2)}% > limite ${(slo.max5xxRate * 100).toFixed(2)}%`,
      );
    }
  }
  if (slo.minRps !== undefined && summary.rps < slo.minRps) {
    failures.push(`rps ${summary.rps.toFixed(1)} < mínimo ${slo.minRps}`);
  }

  return { passed: failures.length === 0, failures };
}
