/**
 * Lógica PURA do servidor de métricas (metrics-server.ts).
 *
 * Separa a formatação de labels Prometheus, a formatação legível do
 * uptime e a montagem do objeto StatusResponse da camada de I/O
 * (fetch, DLQ, step trackers, queue provider). Todas as funções aqui
 * são síncronas e 100% testáveis sem rede/Redis.
 *
 * O I/O fica em `metrics-server.ts`, que consome este módulo.
 */

import type {
  CounterMetric,
  HistogramMetric,
  Metric,
  StatusResponse,
  StepTrackers,
  TrackedError,
} from './metrics-server.ts';

// ─── Prometheus labels ───────────────────────────────────────────────────

/** Escapa os caracteres especiais de um valor de label Prometheus. */
export function escapePromLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/** Formata um mapa de labels como `{k="v",...}` (vazio se não houver). */
export function formatLabels(labels: Record<string, string>): string {
  const parts = Object.entries(labels).map(([k, v]) => `${k}="${escapePromLabel(v)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

// ─── Uptime ──────────────────────────────────────────────────────────────

/**
 * Formata o uptime em ms como string legível ("Nd Nh Nm Ns").
 * Maior unidade é omitida quando zero (ex.: "5m 3s" em vez de "0h 5m 3s").
 */
export function formatUptime(uptimeMs: number): string {
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

// ─── Montagem do StatusResponse ──────────────────────────────────────────

export interface StatusResponseInput {
  serviceName: string;
  startTimeMs: number;
  stepTrackers: StepTrackers;
  nowMs: number;
  dlqCount: number;
  queueSize: number | null;
  statusOverrides: Record<string, unknown>;
  recentErrors: Array<{ time: string; message: string; count: number }>;
  countersSnapshot: Record<string, number | string>;
  /** Gera a string de uptime a partir de ms. Injetável p/ teste. */
  formatUptimeFn?: (ms: number) => string;
}

/**
 * Monta o objeto StatusResponse a partir de dados já resolvidos
 * (dlqCount, queueSize, recentErrors, countersSnapshot). A camada de
 * I/O em `metrics-server.ts` resolve esses valores (DLQ, provider,
 * snapshots) e passa para cá — esta função é pura e determinística
 * dado o `nowMs` e `startTimeMs`.
 */
export function buildStatusResponse(input: StatusResponseInput): StatusResponse {
  const uptimeMs = input.nowMs - input.startTimeMs;
  const uptimeSeconds = Math.floor(uptimeMs / 1000);
  const fmt = input.formatUptimeFn ?? formatUptime;

  const stepDurations: Record<string, { avg: number; p50: number; p99: number; count: number }> =
    {};
  for (const [name, tracker] of Object.entries(input.stepTrackers)) {
    stepDurations[name] = tracker.snapshot();
  }

  return {
    ...input.statusOverrides,
    service: input.serviceName,
    status: 'healthy',
    uptime: fmt(uptimeMs),
    uptimeSeconds,
    startTime: new Date(input.startTimeMs).toISOString(),
    mode: (input.statusOverrides.mode as string) || 'unknown',
    queueSize: input.queueSize,
    dlqCount: input.dlqCount,
    stepDurations,
    errors: [...input.recentErrors].sort(
      (a, b) => new Date(b.time).getTime() - new Date(a.time).getTime(),
    ),
    counters: input.countersSnapshot,
  };
}

// ─── Autenticação (pura) ─────────────────────────────────────────────────

/**
 * Valida a requisição de métricas contra a API key configurada.
 * Se nenhuma API key foi configurada, qualquer requisição é aceita
 * (ambiente de dev). Caso contrário, aceita Bearer <key> ou header
 * x-api-key igual à key.
 */
export function authenticateMetricsRequest(
  apiKey: string,
  authHeader: string,
  apiKeyHeader: string,
): boolean {
  if (!apiKey) return true;
  if (authHeader.startsWith('Bearer ') && authHeader.slice(7) === apiKey) {
    return true;
  }
  if (apiKeyHeader === apiKey) return true;
  return false;
}

// ─── Parsing de query / resposta HTTP (puro) ───────────────────────────

/**
 * Chave de label Prometheus derivada dos valores (join por vírgula).
 * Usada internamente por `getMetrics` / `getStatusResponse` para indexar
 * as séries por combinação de labels — função PURO.
 */
export function promLabelKey(labels: Record<string, string>): string {
  return Object.values(labels).join(',');
}

/** Parse de um parâmetro de query numérico (base 10). */
export function parseQueryInt(raw: string | null, fallback: number): number {
  if (raw == null) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Extrai offset/limit do objeto URLSearchParams para o endpoint /dlq.
 * offset default 0, limit default 20.
 */
export function parseDlqListQuery(params: URLSearchParams): { offset: number; limit: number } {
  return {
    offset: parseQueryInt(params.get('offset'), 0),
    limit: parseQueryInt(params.get('limit'), 20),
  };
}

/**
 * Extrai o parâmetro obrigatório `id` de URLSearchParams.
 * Retorna null se ausente ou vazio.
 */
export function parseRequiredQueryParam(params: URLSearchParams, name: string): string | null {
  const value = params.get(name);
  return value && value.length > 0 ? value : null;
}

/**
 * Lista de endpoints expostos pelo servidor de métricas (usado pelo
 * handler `/`). Função PURO — só monta o array de strings.
 */
export function buildInfoEndpoints(serviceName: string): string[] {
  return [
    '/metrics',
    '/health',
    '/status',
    '/dlq',
    '/dlq/count',
    `/dlq/requeue?id=...`,
    `/dlq/remove?id=...`,
    '/dlq/purge',
  ];
}

// ─── Renderização Prometheus text ──────────────────────────────────────

/** Junta os valores de label por vírgula (chave interna dos Map). */
export function promLabelKeyValue(labels: Record<string, string>): string {
  return Object.values(labels).join(',');
}

/**
 * Reconstrói um mapa de labels a partir da chave interna (join por vírgula)
 * e da lista ordenada de `labelNames`. Usado ao renderizar séries
 * rotuladas no texto Prometheus.
 */
export function labelsFromKey(key: string, labelNames: string[]): Record<string, string> {
  const values = key.split(',');
  const labels: Record<string, string> = {};
  labelNames.forEach((ln, i) => {
    labels[ln] = values[i] ?? '';
  });
  return labels;
}

/**
 * Renderiza uma métrica individual (counter ou histogram) no formato
 * Prometheus text (HELP/TYPE + séries). Função PURO — recebe a métrica
 * já resolvida (vem do `Map` de `metrics-server.ts`) e devolve as linhas.
 */
export function renderMetricLine(name: string, metric: Metric): string[] {
  const lines: string[] = [];

  if (metric.type === 'counter') {
    const counter = metric as CounterMetric;
    lines.push(`# HELP ${name} ${counter.help}`);
    lines.push(`# TYPE ${name} counter`);

    if (counter.labelNames.length > 0) {
      for (const [key, value] of counter.counts) {
        const labels = labelsFromKey(key, counter.labelNames);
        lines.push(`${name}${formatLabels(labels)} ${value}`);
      }
    } else {
      lines.push(`${name} ${counter.value}`);
    }
  } else {
    const hist = metric as HistogramMetric;
    lines.push(`# HELP ${name} ${hist.help}`);
    lines.push(`# TYPE ${name} histogram`);

    for (const [key, obs] of hist.observations) {
      const labels = labelsFromKey(key, hist.labelNames);
      const labelStr = formatLabels(labels);

      for (const bc of obs.bucketCounts) {
        lines.push(`${name}_bucket${labelStr}{le="${bc.le}"} ${bc.count}`);
      }
      lines.push(`${name}_bucket${labelStr}{le="+Inf"} ${obs.count}`);
      lines.push(`${name}_count${labelStr} ${obs.count}`);
      lines.push(`${name}_sum${labelStr} ${obs.sum}`);
    }
  }

  return lines;
}

/** Junta as linhas Prometheus num único texto (terminado em `\n`). */
export function joinPrometheusLines(lines: string[]): string {
  return lines.join('\n') + '\n';
}

// ─── Snapshot de counters para /status ────────────────────────────────

/**
 * Constrói o `countersSnapshot` exibido no endpoint /status a partir do
 * mapa de métricas. Séries rotuladas viram `${name}{k=v,...}`; counters
 * simples viram `${name}`. Função PURO.
 */
export function buildCountersSnapshot(
  metrics: Map<string, Metric>,
): Record<string, number | string> {
  const snapshot: Record<string, number | string> = {};

  for (const [name, metric] of metrics) {
    if (metric.type === 'counter') {
      const counter = metric as CounterMetric;
      if (counter.labelNames.length > 0) {
        for (const [key, value] of counter.counts) {
          const labels = labelsFromKey(key, counter.labelNames);
          const labelStr = counter.labelNames.map((ln, i) => `${ln}=${labels[ln] ?? ''}`).join(',');
          snapshot[`${name}{${labelStr}}`] = value;
        }
      } else {
        snapshot[name] = counter.value;
      }
    }
  }

  return snapshot;
}

// ─── TrackedError (erros recentes) ─────────────────────────────────────

/**
 * Atualiza o mapa de erros rastreados (inserção/agregação/eviction LRU).
 *
 * Função PURO: recebe o mapa atual e o `MAX_TRACKED_ERRORS` e DEVOLVE o
 * mapa atualizado (não muta a entrada — caller decide se reatribui).
 * `nowIso` é injetável p/ teste determinístico.
 */
export function trackError(
  errors: Map<string, TrackedError>,
  message: string,
  maxTracked: number,
  nowIso: string,
): Map<string, TrackedError> {
  const next = new Map(errors);
  const existing = next.get(message);

  if (existing) {
    existing.count++;
    existing.time = nowIso;
  } else {
    next.set(message, { time: nowIso, message, count: 1 });
    if (next.size > maxTracked) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of next) {
        const t = new Date(v.time).getTime();
        if (t < oldestTime) {
          oldestTime = t;
          oldestKey = k;
        }
      }
      if (oldestKey) next.delete(oldestKey);
    }
  }

  return next;
}
