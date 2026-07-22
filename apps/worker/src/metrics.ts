/**
 * Métricas Prometheus para o worker de espelhamento.
 *
 * Contadores:
 *   mirror_messages_received_total
 *   mirror_messages_converted_total          (marketplace)
 *   mirror_messages_sent_total
 *   mirror_messages_blocked_total            (reason)
 *   mirror_failures_total                    (type, marketplace)
 *   mirror_deduplicated_total
 *
 * Histograma:
 *   mirror_conversion_duration_seconds       (marketplace)
 *
 * Exposição HTTP em METRICS_PORT (default 9092):
 *   /metrics    — Prometheus text format
 *   /health     — OK (orquestrador)
 *   /status     — JSON com health, uptime, erros acumulados, DLQ count
 *   /dlq/*      — Dead Letter Queue management
 */

// ─── Tipos internos ──────────────────────────────────────────────────

interface CounterMetric {
  value: number;
  help: string;
  labelNames: string[];
  counts: Map<string, number>; // key = label values joined by ","
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

// ─── Estado interno ──────────────────────────────────────────────────

const metrics = new Map<string, Metric>();

// ─── Helpers ──────────────────────────────────────────────────────────

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

// ─── API pública ─────────────────────────────────────────────────────

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

  // Incrementa os buckets cujo le seja >= value
  // (bucket +Inf é tratado separadamente no output)
  for (const bc of obs.bucketCounts) {
    if (value <= bc.le) {
      bc.count++;
    }
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
          lines.push(
            `${name}_bucket${labelStr}{le="${bc.le}"} ${bc.count}`,
          );
        }
        lines.push(`${name}_bucket${labelStr}{le="+Inf"} ${obs.count}`);
        lines.push(`${name}_count${labelStr} ${obs.count}`);
        lines.push(`${name}_sum${labelStr} ${obs.sum}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

export function registerDefaultMetrics(): void {
  createCounter(
    'mirror_messages_received_total',
    'Total de mensagens recebidas para processamento',
  );
  createCounter(
    'mirror_messages_converted_total',
    'Total de URLs convertidas com sucesso',
    ['marketplace'],
  );
  createCounter(
    'mirror_messages_sent_total',
    'Total de mensagens enviadas para grupos de destino',
  );
  createCounter(
    'mirror_messages_blocked_total',
    'Total de mensagens bloqueadas (não passaram pelos filtros)',
    ['reason'],
  );
  createCounter(
    'mirror_failures_total',
    'Total de falhas no pipeline',
    ['type', 'marketplace'],
  );
  createCounter(
    'mirror_deduplicated_total',
    'Total de ofertas duplicadas ignoradas',
  );
  createCounter(
    'mirror_rate_limited_total',
    'Total de vezes que o rate limit foi acionado por instância',
    ['instance_name'],
  );
  createCounter(
    'mirror_rate_limit_wait_ms_total',
    'Tempo total de espera acumulado devido a rate limit (ms)',
  );
  createHistogram(
    'mirror_conversion_duration_seconds',
    'Tempo gasto na conversão de URLs de oferta',
    ['marketplace'],
  );
}

// ─── Erros acumulados para o /status ──────────────────────────────────

/** Timestamp de inicialização do servidor de métricas. */
let startTime = Date.now();

/** Interface de erro rastreado. */
export interface TrackedError {
  time: string;
  message: string;
  count: number;
}

/** Últimos erros (agrupados por mensagem, até 20). */
const recentErrors = new Map<string, TrackedError>();

/** Limite de erros rastreados. */
const MAX_TRACKED_ERRORS = 20;

/**
 * Registra um erro no tracker interno do /status.
 * Erros com a mesma mensagem são agrupados (incrementa count).
 */
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
    // Se estourou o limite, remove o mais velho
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

/**
 * Dados extras que o index.ts pode registrar para enriquecer o /status.
 * Ex: modo, tamanho da fila, etc.
 */
let statusOverrides: Record<string, unknown> = {};

/**
 * Permite que index.ts registre dados adicionais para o /status.
 */
export function setStatusMeta(meta: Record<string, unknown>): void {
  statusOverrides = { ...statusOverrides, ...meta };
}

/**
 * Retorna o objeto de status completo para o endpoint /status.
 */
export async function getStatusResponse(): Promise<Record<string, unknown>> {
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

  // Tenta ler DLQ count
  let dlqCount = 0;
  try {
    const { countDLQ } = await import('./dead-letter-queue.ts');
    dlqCount = await countDLQ();
  } catch {
    // DLQ pode estar indisponível — não falha
  }

  // Counter values resumidas
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
    service: 'mirror-worker-metrics',
    status: 'healthy',
    uptimeSeconds,
    uptime: uptimeFormatted,
    startTime: new Date(startTime).toISOString(),
    mode: statusOverrides.mode || 'unknown',
    queueSize: statusOverrides.queueSize ?? null,
    dlqCount,
    errors: Array.from(recentErrors.values()).sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    ),
    counters: countersSnapshot,
    ...statusOverrides,
  };
}

// ─── HTTP Server ─────────────────────────────────────────────────────

const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9092', 10);
const METRICS_API_KEY = process.env.METRICS_API_KEY || '';

let metricsServer: { stop(): void } | null = null;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Verifica se a requisição possui o METRICS_API_KEY correto.
 * Se METRICS_API_KEY não estiver configurada, pula a verificação (compat retroativa).
 * Se configurada, aceita Authorization: Bearer <key> ou X-API-Key: <key>.
 */
function authenticateRequest(req: Request): boolean {
  if (!METRICS_API_KEY) return true; // sem chave configurada → livre

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

/**
 * Inicia um servidor HTTP que expõe as métricas em /metrics e endpoints
 * da Dead Letter Queue em /dlq/*.
 * Pode ser chamado uma única vez — chamadas subsequentes são ignoradas.
 *
 * @param portOverride — Porta opcional para override (usado em testes).
 *   Se omitido, usa METRICS_PORT do ambiente (default 9092).
 */
export function startMetricsServer(portOverride?: number): void {
  if (metricsServer) return;

  registerDefaultMetrics();

  const effectivePort = portOverride ?? METRICS_PORT;

  metricsServer = Bun.serve({
    port: effectivePort,
    async fetch(req) {
      const url = new URL(req.url);

      // /health é livre (usado pelo healthcheck do Docker Compose)
      if (url.pathname === '/health') {
        return new Response('OK', { status: 200 });
      }

      // Demais endpoints requerem autenticação se METRICS_API_KEY estiver configurada
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

      // ── Status endpoint ───────────────────────────────────────────
      if (url.pathname === '/status') {
        const status = await getStatusResponse();
        return jsonResponse(status);
      }

      // ── Dead Letter Queue endpoints ─────────────────────────────
      if (url.pathname === '/dlq/count') {
        const { countDLQ } = await import('./dead-letter-queue.ts');
        const count = await countDLQ();
        return jsonResponse({ count });
      }

      if (url.pathname === '/dlq') {
        const { listDLQ } = await import('./dead-letter-queue.ts');
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
        const { requeueFromDLQ } = await import('./dead-letter-queue.ts');
        const ok = await requeueFromDLQ(id);
        return jsonResponse({ success: ok, dlqId: id });
      }

      if (url.pathname === '/dlq/remove' && req.method === 'POST') {
        const id = url.searchParams.get('id');
        if (!id) {
          return jsonResponse({ error: 'Parâmetro "id" é obrigatório' }, 400);
        }
        const { removeFromDLQ } = await import('./dead-letter-queue.ts');
        const ok = await removeFromDLQ(id);
        return jsonResponse({ success: ok, dlqId: id });
      }

      if (url.pathname === '/dlq/purge' && req.method === 'POST') {
        const { purgeOldDLQItems } = await import('./dead-letter-queue.ts');
        const removed = await purgeOldDLQItems();
        return jsonResponse({ removed });
      }

      if (url.pathname === '/') {
        return jsonResponse({
          service: 'mirror-worker-metrics',
          endpoints: [
            '/metrics',
            '/health',
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

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'mirror-metrics',
      message: 'Servidor de métricas iniciado',
      port: METRICS_PORT,
    }),
  );
}

export function stopMetricsServer(): void {
  if (metricsServer) {
    metricsServer.stop();
    metricsServer = null;
  }
}

/**
 * Reseta o estado interno do módulo de métricas.
 * Usado em testes para garantir estado limpo entre execuções.
 */
export function resetMetrics(): void {
  metrics.clear();
  recentErrors.clear();
  statusOverrides = {};
  startTime = Date.now();
}
