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
  stepDurations: Record<string, {
    avg: number;
    p50: number;
    p99: number;
    count: number;
  }>;
  errors: Array<{ time: string; message: string; count: number }>;
  counters: Record<string, number | string>;
  [key: string]: unknown;
}

// ─── Métricas Prometheus ─────────────────────────────────────────────────

interface CounterMetric {
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

interface HistogramMetric {
  help: string;
  labelNames: string[];
  buckets: number[];
  observations: Map<string, HistogramObservation>;
  type: 'histogram';
}

type Metric = CounterMetric | HistogramMetric;

const metrics = new Map<string, Metric>();

function labelKey(labels: Record<string, string>): string {
  return Object.values(labels).join(',');
}

function escapePromLabel(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function formatLabels(labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(
    ([k, v]) => `${k}="${escapePromLabel(v)}"`,
  );
  return parts.length ? `{${parts.join(',')}}` : '';
}

export function createCounter(
  name: string,
  help: string,
  labelNames: string[] = [],
): void {
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

export function incrementCounter(
  name: string,
  labels: Record<string, string> = {},
): void {
  const metric = metrics.get(name);
  if (!metric || metric.type !== 'counter') {
    console.warn(`[metrics] Counter "${name}" not found`);
    return;
  }
  const counter = metric as CounterMetric;
  if (Object.keys(labels).length > 0) {
    const key = labelKey(labels);
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
  const key = labelKey(labels);

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
    if (metric.type === 'counter') {
      const counter = metric as CounterMetric;
      lines.push(`# HELP ${name} ${counter.help}`);
      lines.push(`# TYPE ${name} counter`);

      if (counter.labelNames.length > 0) {
        for (const [key, value] of counter.counts) {
          const labelValues = key.split(',');
          const labels: Record<string, string> = {};
          counter.labelNames.forEach((ln, i) => {
            labels[ln] = labelValues[i] || '';
          });
          lines.push(`${name}${formatLabels(labels)} ${value}`);
        }
      } else {
        lines.push(`${name} ${counter.value}`);
      }
    } else if (metric.type === 'histogram') {
      const hist = metric as HistogramMetric;
      lines.push(`# HELP ${name} ${hist.help}`);
      lines.push(`# TYPE ${name} histogram`);

      for (const [key, obs] of hist.observations) {
        const labels: Record<string, string> = {};
        hist.labelNames.forEach((ln, i) => {
          labels[ln] = key.split(',')[i] || '';
        });
        const labelStr = formatLabels(labels);

        for (const bc of obs.bucketCounts) {
          lines.push(`${name}_bucket${labelStr}{le="${bc.le}"} ${bc.count}`);
        }
        lines.push(`${name}_bucket${labelStr}{le="+Inf"} ${obs.count}`);
        lines.push(`${name}_count${labelStr} ${obs.count}`);
        lines.push(`${name}_sum${labelStr} ${obs.sum}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Status ──────────────────────────────────────────────────────────────

let startTime = Date.now();
let stepTrackers: StepTrackers = {};
let statusOverrides: Record<string, unknown> = {};

export function registerStepTrackers(trackers: StepTrackers): void {
  stepTrackers = trackers;
}

export function setStatusMeta(meta: Record<string, unknown>): void {
  statusOverrides = { ...statusOverrides, ...meta };
}

interface TrackedError {
  time: string;
  message: string;
  count: number;
}

const recentErrors = new Map<string, TrackedError>();
const MAX_TRACKED_ERRORS = 20;

export function trackError(message: string): void {
  const existing = recentErrors.get(message);
  if (existing) {
    existing.count++;
    existing.time = new Date().toISOString();
  } else {
    recentErrors.set(message, {
      time: new Date().toISOString(),
      message,
      count: 1,
    });
    if (recentErrors.size > MAX_TRACKED_ERRORS) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of recentErrors) {
        const t = new Date(v.time).getTime();
        if (t < oldestTime) {
          oldestTime = t;
          oldestKey = k;
        }
      }
      if (oldestKey) recentErrors.delete(oldestKey);
    }
  }
}

export async function getStatusResponse(
  serviceName: string,
  targetStream: string,
): Promise<StatusResponse> {
  const uptimeMs = Date.now() - startTime;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  const uptimeFormatted =
    days > 0
      ? `${days}d ${hours}h ${minutes}m ${seconds}s`
      : hours > 0
        ? `${hours}h ${minutes}m ${seconds}s`
        : `${minutes}m ${seconds}s`;

  let dlqCount = 0;
  try {
    dlqCount = await countDLQ();
  } catch {
    // DLQ indisponível
  }

  const stepDurations: Record<string, { avg: number; p50: number; p99: number; count: number }> = {};
  for (const [name, tracker] of Object.entries(stepTrackers)) {
    stepDurations[name] = tracker.snapshot();
  }

  const countersSnapshot: Record<string, number | string> = {};
  for (const [name, metric] of metrics) {
    if (metric.type === 'counter') {
      const counter = metric as CounterMetric;
      if (counter.labelNames.length > 0) {
        for (const [key, value] of counter.counts) {
          const labelValues = key.split(',');
          const labelStr = counter.labelNames
            .map((ln, i) => `${ln}=${labelValues[i] || ''}`)
            .join(',');
          countersSnapshot[`${name}{${labelStr}}`] = value;
        }
      } else {
        countersSnapshot[name] = counter.value;
      }
    }
  }

  return {
    service: serviceName,
    status: 'healthy',
    uptime: uptimeFormatted,
    uptimeSeconds,
    startTime: new Date(startTime).toISOString(),
    mode: (statusOverrides.mode as string) || 'unknown',
    queueSize: (statusOverrides.queueSize as number) ?? null,
    dlqCount,
    stepDurations,
    errors: Array.from(recentErrors.values()).sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    ),
    counters: countersSnapshot,
    ...statusOverrides,
  };
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
  if (!METRICS_API_KEY) return true;

  const authHeader = req.headers.get('authorization') || '';
  const apiKeyHeader = req.headers.get('x-api-key') || '';

  if (authHeader.startsWith('Bearer ') && authHeader.slice(7) === METRICS_API_KEY) {
    return true;
  }
  if (apiKeyHeader === METRICS_API_KEY) {
    return true;
  }
  return false;
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
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const result = await listDLQ({ offset, limit });
        return jsonResponse(result);
      }

      if (url.pathname === '/dlq/requeue' && req.method === 'POST') {
        const id = url.searchParams.get('id');
        if (!id) {
          return jsonResponse({ error: 'Parâmetro "id" é obrigatório' }, 400);
        }
        const ok = await requeueFromDLQ(id, targetStream);
        return jsonResponse({ success: ok, dlqId: id });
      }

      if (url.pathname === '/dlq/remove' && req.method === 'POST') {
        const id = url.searchParams.get('id');
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
          endpoints: [
            '/metrics',
            '/health',
            '/status',
            '/dlq',
            '/dlq/count',
            '/dlq/requeue?id=...',
            '/dlq/remove?id=...',
            '/dlq/purge',
          ],
        });
      }

      return new Response('Not Found', { status: 404 });
    },
  });

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: serviceName,
    message: 'Servidor de métricas iniciado',
    port: effectivePort,
  }));
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