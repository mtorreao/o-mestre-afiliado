/**
 * Tipos e helpers para a tela de Status do Worker (Ingestor + Dispatcher).
 */

// ─── Tipos ──────────────────────────────────────────

export type WorkerServiceName = 'ingestor' | 'dispatcher';

export interface StepDuration {
  avg: number;
  p50: number;
  p99: number;
  count: number;
}

export interface ServiceStatus {
  name: WorkerServiceName;
  reachable: boolean;
  error?: string;
  service?: string;
  status?: string;
  uptime?: string;
  uptimeSeconds?: number;
  startTime?: string;
  mode?: string;
  queueSize?: number | null;
  dlqCount?: number;
  stepDurations?: Record<string, StepDuration>;
  errors?: { time: string; message: string; count: number }[];
  counters?: Record<string, number | string>;
}

export interface AggregatedWorkerStatus {
  success: boolean;
  services: ServiceStatus[];
  pipeline: {
    queueA: number | null;
    queueB: number | null;
  };
}

export interface DLQEntry {
  id: string;
  failureReason: string;
  attempts: number;
  lastError: string;
  failedAt: string;
  marketplace?: string;
  originalUrl?: string;
  conversionSuccess?: boolean;
  reprocessed: boolean;
  reprocessedAt?: string;
  reprocessResult?: string;
}

export interface DLQListResponse {
  success: boolean;
  items: DLQEntry[];
  total: number;
  offset: number;
  limit: number;
}

// ─── Labels amigáveis para métricas ─────────────────

const COUNTER_LABELS: Record<string, string> = {
  // Ingestor
  pipeline_messages_received_total: 'Recebidas',
  pipeline_messages_blocked_total: 'Bloqueadas',
  pipeline_affiliates_per_message: 'Afiliados/msg',
  pipeline_send_events_published_total: 'Eventos publicados',
  pipeline_image_fetch_total: 'Busca de imagem',
  pipeline_image_missing_fallback_total: 'Sem imagem (fallback)',
  // Dispatcher
  sender_events_received_total: 'Eventos recebidos',
  sender_messages_sent_total: 'Enviadas',
  sender_messages_sent_with_image_total: 'Enviadas c/ imagem',
  sender_messages_skipped_total: 'Descartadas',
  sender_failures_total: 'Falhas',
};

const STEP_LABELS: Record<string, string> = {
  // Ingestor
  dedup: 'Dedup',
  extract: 'Extração',
  blacklist: 'Blacklist',
  whitelist: 'Whitelist',
  imageFetch: 'Busca imagem',
  resolveRedirect: 'Resolve redirect',
  fanOut: 'Fan-out',
  total: 'Total',
  // Dispatcher
  rateLimitWait: 'Rate limit',
  send: 'Envio',
};

export function counterLabel(key: string): string {
  // Extrai o nome base (antes de {labels})
  const base = key.split('{')[0] ?? key;
  return COUNTER_LABELS[base] ?? base;
}

export function stepLabel(key: string): string {
  return STEP_LABELS[key] ?? key;
}

export function formatMs(ms: number): string {
  if (ms < 1) return `${Math.round(ms * 1000)}µs`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}
