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
 * Exposição via HTTP em /metrics na porta METRICS_PORT (default 9092).
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

// ─── HTTP Server ─────────────────────────────────────────────────────

const METRICS_PORT = parseInt(process.env.METRICS_PORT || '9092', 10);

let metricsServer: { stop(): void } | null = null;

/**
 * Inicia um servidor HTTP que expõe as métricas em /metrics.
 * Pode ser chamado uma única vez — chamadas subsequentes são ignoradas.
 */
export function startMetricsServer(): void {
  if (metricsServer) return;

  registerDefaultMetrics();

  metricsServer = Bun.serve({
    port: METRICS_PORT,
    async fetch(req) {
      const url = new URL(req.url);

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

      if (url.pathname === '/health') {
        return new Response('OK', { status: 200 });
      }

      if (url.pathname === '/') {
        return new Response(
          JSON.stringify({
            service: 'mirror-worker-metrics',
            endpoints: ['/metrics', '/health'],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
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
