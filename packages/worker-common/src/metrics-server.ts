/**
 * Servidor de métricas HTTP genérico para processadores do worker.
 *
 * Cada processador (Ingestor na porta 9092, Dispatcher na porta 9093)
 * cria suas próprias instâncias de StepTrackers e counters.
 *
 * Endpoints:
 *   /health  — OK (healthcheck Docker)
 *   /metrics — Prometheus text format
 *   /status  — JSON com health, uptime, step durations, counters
 *   /dlq/*   — Dead Letter Queue management
 */

import type { StepTracker } from './step-tracker.ts';
import {
  countDLQ,
  listDLQ,
  requeueFromDLQ,
  removeFromDLQ,
  purgeOldDLQItems,
} from './dead-letter-queue.ts';
import {
  authenticateMetricsRequest,
  buildCountersSnapshot,
  buildInfoEndpoints,
  buildStatusResponse,
  formatLabels,
  formatUptime,
  joinPrometheusLines,
  labelsFromKey,
  parseDlqListQuery,
  parseRequiredQueryParam,
  promLabelKeyValue,
  renderMetricLine,
  trackError as trackErrorPure,
} from './metrics-server-pure.ts';

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface StepTrackers {
  [stepName: string]: StepTracker;
}

export interface StatusResponse {
  service: string;
  status: 'healthy' | 'degraded';
  uptime: string;
  uptimeSeconds: number;
  startTime: string;
  mode: string;
  queueSize: number | null;
  dlqCount: number;
  stepDurations: Record<
    string,
    {
      avg: number;
      p50: number;
      p99: number;
      count: number;
    }
  >;
  errors: Array<{ time: string; message: string; count: number }>;
  counters: Record<string, number | string>;
  [key: string]: unknown;
}

// ─── Métricas Prometheus ─────────────────────────────────────────────────

export interface CounterMetric {
  value: number;
  help: string;
  labelNames: string[];
  counts: Map<string, number>;
  type: 'counter';
}

interface HistogramObservation {
  sum: number;
  count: number;
  bucketCounts: { le: number; count: number }[];
}

export interface HistogramMetric {
  help: string;
  labelNames: string[];
  buckets: number[];
  observations: Map<string, HistogramObservation>;
  type: 'histogram';
}

export type Metric = CounterMetric | HistogramMetric;

const metrics = new Map<string, Metric>();

export function createCounter(name: string, help: string, labelNames: string[] = []): void {
  if (metrics.has(name)) return;
  metrics.set(name, {
    value: 0,
    help,
    labelNames,
    counts: new Map(),
    type: 'counter',
  });
}

export function createHistogram(
  name: string,
  help: string,
  labelNames: string[] = [],
  buckets: number[] = [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
): void {
  if (metrics.has(name)) return;
  metrics.set(name, {
    help,
    labelNames,
    buckets,
    observations: new Map(),
    type: 'histogram',
  });
}

export function incrementCounter(name: string, labels: Record<string, string> = {}): void {
  const metric = metrics.get(name);
  if (!metric || metric.type !== 'counter') {
    console.warn(`[metrics] Counter "${name}" not found`);
    return;
  }
  const counter = metric as CounterMetric;
  if (Object.keys(labels).length > 0) {
    const key = promLabelKeyValue(labels);
    counter.counts.set(key, (counter.counts.get(key) || 0) + 1);
  } else {
    counter.value++;
  }
}

export function observeHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {},
): void {
  const metric = metrics.get(name);
  if (!metric || metric.type !== 'histogram') {
    console.warn(`[metrics] Histogram "${name}" not found`);
    return;
  }
  const hist = metric as HistogramMetric;
  const key = promLabelKeyValue(labels);

  let obs = hist.observations.get(key);
  if (!obs) {
    obs = {
      sum: 0,
      count: 0,
      bucketCounts: hist.buckets.map((le) => ({ le, count: 0 })),
    };
    hist.observations.set(key, obs);
  }

  obs.sum += value;
  obs.count++;

  for (const bc of obs.bucketCounts) {
    if (value <= bc.le) bc.count++;
  }
}

export function getMetrics(): string {
  const lines: string[] = [];

  for (const [name, metric] of metrics) {
    lines.push(...renderMetricLine(name, metric));
  }

  return joinPrometheusLines(lines);
}

// ─── Status ──────────────────────────────────────────────────────────────

let startTime = Date.now();
let stepTrackers: StepTrackers = {};
let statusOverrides: Record<string, unknown> = {};
let queueSizeProvider: (() => Promise<number | null>) | null = null;

export function registerStepTrackers(trackers: StepTrackers): void {
  stepTrackers = trackers;
}

export function setStatusMeta(meta: Record<string, unknown>): void {
  statusOverrides = { ...statusOverrides, ...meta };
}

/**
 * Registra um provider que retorna a profundidade da fila (XLEN do stream).
 * Chamado sob demanda no /status — o provider deve tratar indisponibilidade
 * retornando null.
 */
export function setQueueSizeProvider(provider: () => Promise<number | null>): void {
  queueSizeProvider = provider;
}

export interface TrackedError {
  time: string;
  message: string;
  count: number;
}

let recentErrors = new Map<string, TrackedError>();
const MAX_TRACKED_ERRORS = 20;

export function trackError(message: string): void {
  // Delega a lógica pura (não-mutante) e atualiza o mapa module-level.
  recentErrors = trackErrorPure(
    recentErrors,
    message,
    MAX_TRACKED_ERRORS,
    new Date().toISOString(),
  );
}

export async function getStatusResponse(
  serviceName: string,
  targetStream: string,
): Promise<StatusResponse> {
  let dlqCount = 0;
  try {
    dlqCount = await countDLQ();
  } catch {
    // DLQ indisponível
  }

  let queueSize: number | null = (statusOverrides.queueSize as number) ?? null;
  if (queueSizeProvider) {
    try {
      queueSize = await queueSizeProvider();
    } catch {
      // provider indisponível — mantém override/null
    }
  }

  const countersSnapshot = buildCountersSnapshot(metrics);

  return buildStatusResponse({
    serviceName,
    startTimeMs: startTime,
    stepTrackers,
    nowMs: Date.now(),
    dlqCount,
    queueSize,
    statusOverrides,
    recentErrors: Array.from(recentErrors.values()),
    countersSnapshot,
  });
}

// ─── HTTP Server ─────────────────────────────────────────────────────────

const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9092', 10);
const METRICS_API_KEY = process.env.METRICS_API_KEY || '';

let metricsServer: { stop(): void } | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function authenticateRequest(req: Request): boolean {
  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';
  return authenticateMetricsRequest(METRICS_API_KEY, authHeader, apiKeyHeader);
}

export function startMetricsServer(
  serviceName: string,
  targetStream: string,
  portOverride?: number,
): void {
  if (metricsServer) return;

  const effectivePort = portOverride ?? METRICS_PORT;

  metricsServer = Bun.serve({
    port: effectivePort,
    async fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === '/health') {
        return new Response('OK', { status: 200 });
      }

      if (!authenticateRequest(req)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }

      if (url.pathname === '/metrics') {
        const body = getMetrics();
        return new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        });
      }

      if (url.pathname === '/status') {
        const status = await getStatusResponse(serviceName, targetStream);
        return jsonResponse(status);
      }

      if (url.pathname === '/dlq/count') {
        const count = await countDLQ();
        return jsonResponse({ count });
      }

      if (url.pathname === '/dlq') {
        const { offset, limit } = parseDlqListQuery(url.searchParams);
        const result = await listDLQ({ offset, limit });
        return jsonResponse(result);
      }

      if (url.pathname === '/dlq/requeue' && req.method === 'POST') {
        const id = parseRequiredQueryParam(url.searchParams, 'id');
        if (!id) {
          return jsonResponse({ error: 'Parâmetro "id" é obrigatório' }, 400);
        }
        const ok = await requeueFromDLQ(id, targetStream);
        return jsonResponse({ success: ok, dlqId: id });
      }

      if (url.pathname === '/dlq/remove' && req.method === 'POST') {
        const id = parseRequiredQueryParam(url.searchParams, 'id');
        if (!id) {
          return jsonResponse({ error: 'Parâmetro "id" é obrigatório' }, 400);
        }
        const ok = await removeFromDLQ(id);
        return jsonResponse({ success: ok, dlqId: id });
      }

      if (url.pathname === '/dlq/purge' && req.method === 'POST') {
        const removed = await purgeOldDLQItems();
        return jsonResponse({ removed });
      }

      if (url.pathname === '/') {
        return jsonResponse({
          service: serviceName,
          endpoints: buildInfoEndpoints(serviceName),
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: serviceName,
      message: 'Servidor de métricas iniciado',
      port: effectivePort,
    }),
  );
}

export function stopMetricsServer(): void {
  if (metricsServer) {
    metricsServer.stop();
    metricsServer = null;
  }
}

export function resetMetrics(): void {
  metrics.clear();
  recentErrors.clear();
  statusOverrides = {};
  startTime = Date.now();
  stepTrackers = {};
}
