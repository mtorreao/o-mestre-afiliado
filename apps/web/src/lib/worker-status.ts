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
  /** Evento original (RawMessageEvent da Queue A ou SendEvent da Queue B) */
  event?: DLQEvent;
}

/** Subconjunto dos campos que o backend serializa. Discriminated union por `kind`. */
export type DLQEvent =
  | {
      kind: 'raw';
      messageId: string;
      instanceName: string;
      sourceGroupJid: string;
      sourceGroupName?: string;
      text?: string;
      timestamp?: number;
      affiliateId?: number;
      mirrorId?: number;
    }
  | {
      kind: 'send';
      id: string;
      sourceMessageId: string;
      sourceGroupJid: string;
      mirrorId: number;
      text: string;
      imageUrl: string;
      marketplace: string;
      originalUrl: string;
      convertedUrl: string;
    };

/**
 * Normaliza o `event` cru do backend (que vem como objeto union sem discriminator)
 * para o tipo `DLQEvent` discriminado. Retorna undefined se o evento não tem
 * a forma esperada.
 */
export function normalizeDLQEvent(raw: unknown): DLQEvent | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const e = raw as Record<string, unknown>;
  // RawMessageEvent tem 'messageId' (da Queue A / Ingestor)
  if (typeof e.messageId === 'string') {
    return {
      kind: 'raw',
      messageId: e.messageId,
      instanceName: typeof e.instanceName === 'string' ? e.instanceName : '',
      sourceGroupJid: typeof e.sourceGroupJid === 'string' ? e.sourceGroupJid : '',
      sourceGroupName: typeof e.sourceGroupName === 'string' ? e.sourceGroupName : undefined,
      text: typeof e.text === 'string' ? e.text : undefined,
      timestamp: typeof e.timestamp === 'number' ? e.timestamp : undefined,
      affiliateId: typeof e.affiliateId === 'number' ? e.affiliateId : undefined,
      mirrorId: typeof e.mirrorId === 'number' ? e.mirrorId : undefined,
    };
  }
  // SendEvent tem 'sourceMessageId' (da Queue B / Dispatcher)
  if (typeof e.sourceMessageId === 'string' && typeof e.mirrorId === 'number') {
    return {
      kind: 'send',
      id: typeof e.id === 'string' ? e.id : '',
      sourceMessageId: e.sourceMessageId,
      sourceGroupJid: typeof e.sourceGroupJid === 'string' ? e.sourceGroupJid : '',
      mirrorId: e.mirrorId,
      text: typeof e.text === 'string' ? e.text : '',
      imageUrl: typeof e.imageUrl === 'string' ? e.imageUrl : '',
      marketplace: typeof e.marketplace === 'string' ? e.marketplace : '',
      originalUrl: typeof e.originalUrl === 'string' ? e.originalUrl : '',
      convertedUrl: typeof e.convertedUrl === 'string' ? e.convertedUrl : '',
    };
  }
  return undefined;
}

/**
 * Mapeia `failureReason` (string genérica do backend) para:
 *   - `queue`: 'A' (Ingestor) ou 'B' (Dispatcher)
 *   - `stage`: nome legível da etapa que falhou
 *
 * Usado para renderizar "Fila: Queue A · Etapa: Conversão" no card.
 */
export const FAILURE_REASON_META: Record<string, { queue: 'A' | 'B'; stage: string }> = {
  // Ingestor (Queue A)
  conversion_failed:           { queue: 'A', stage: 'Conversão de link' },
  no_url:                      { queue: 'A', stage: 'Extração de URL' },
  multiple_product_links:      { queue: 'A', stage: 'Extração de URL' },
  shopee_shortlink_only:       { queue: 'A', stage: 'Resolução Shopee' },
  coupon_only:                 { queue: 'A', stage: 'Detecção de cupom' },
  global_blacklist:            { queue: 'A', stage: 'Blacklist' },
  global_whitelist:            { queue: 'A', stage: 'Whitelist' },
  affiliate_link_mismatch:     { queue: 'A', stage: 'Validação de afiliado' },
  // Dispatcher (Queue B)
  send_failed:                 { queue: 'B', stage: 'Envio (Evolution)' },
  rate_limited:                { queue: 'B', stage: 'Rate limit' },
  group_rate_limited:          { queue: 'B', stage: 'Rate limit do grupo' },
  // Genéricos / compartilhados
  unknown:                     { queue: 'A', stage: 'Desconhecida' },
};

export function getFailureMeta(reason: string): { queue: 'A' | 'B'; stage: string } {
  if (FAILURE_REASON_META[reason]) return FAILURE_REASON_META[reason];
  // Heurística de fallback: prefixos de Dispatcher (Queue B) são raros
  // e bem distintos dos de Ingestor (Queue A).
  const lower = reason.toLowerCase();
  if (lower.startsWith('send_') || lower.startsWith('rate_') || lower.includes('group_')) {
    return { queue: 'B', stage: humanize(reason) };
  }
  return { queue: 'A', stage: humanize(reason) };
}

function humanize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface DLQListResponse {
  success: boolean;
  items: DLQEntry[];
  total: number;
  offset: number;
  limit: number;
}

// ─── Labels amigáveis para métricas ─────────────────

/**
 * Labels amigáveis para o NOME BASE dos contadores (sem as labels Prometheus).
 * A chave é o `name` (parte antes de `{`), o valor é o texto em PT-BR.
 */
const COUNTER_LABELS: Record<string, string> = {
  // Ingestor
  pipeline_messages_received_total: 'Mensagens recebidas',
  pipeline_messages_blocked_total: 'Mensagens bloqueadas',
  pipeline_affiliates_per_message: 'Afiliados por mensagem',
  pipeline_send_events_published_total: 'SendEvents publicados',
  pipeline_image_fetch_total: 'Busca de imagem',
  pipeline_image_missing_fallback_total: 'Ofertas sem imagem (fallback)',
  // Dispatcher
  sender_events_received_total: 'SendEvents recebidos',
  sender_messages_sent_total: 'Mensagens enviadas',
  sender_messages_sent_with_image_total: 'Enviadas com imagem',
  sender_messages_skipped_total: 'Mensagens descartadas',
  sender_failures_total: 'Falhas de envio',
};

/**
 * Tradução dos VALORES das labels Prometheus (não das chaves das labels).
 * Usado para tornar "reason=conversion_failed" → "Falha na conversão".
 */
export const LABEL_VALUE_LABELS: Record<string, Record<string, string>> = {
  // Ingestor — reason em pipeline_messages_blocked_total
  reason: {
    no_url: 'Sem URL',
    multiple_product_links: 'Múltiplas URLs de produto',
    shopee_shortlink_only: 'Só shortlink Shopee',
    coupon_only: 'Só cupom',
    global_blacklist: 'Blacklist global',
    global_whitelist: 'Fora da whitelist',
    conversion_failed: 'Falha na conversão',
    affiliate_link_mismatch: 'Link de afiliado divergente',
  },
  // Ingestor — result em pipeline_image_fetch_total
  result: {
    found: 'Encontrada',
    not_found: 'Não encontrada',
  },
  // Dispatcher — reason em sender_messages_skipped_total
  // (compartilhado com a chave `reason` acima; mantém consistência)
  // Dispatcher — type em sender_failures_total
  type: {
    rate_limited: 'Rate limit',
    group_rate_limited: 'Rate limit do grupo',
    send_failed: 'Falha no envio',
  },
};

/**
 * Retorna o label PT-BR de um valor de label Prometheus.
 * @param labelName nome da label (ex: "reason", "type", "marketplace")
 * @param value     valor da label (ex: "conversion_failed")
 */
export function labelValueLabel(labelName: string, value: string): string {
  const dict = LABEL_VALUE_LABELS[labelName];
  if (dict && dict[value]) return dict[value];
  // Fallback humanizado: troca _ por espaço e capitaliza
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Labels amigáveis para MARKETPLACE (usado em `sender_messages_sent_total{marketplace=...}`).
 */
export const MARKETPLACE_LABELS: Record<string, string> = {
  shopee: 'Shopee',
  mercadolivre: 'Mercado Livre',
  amazon: 'Amazon',
};

export function marketplaceLabel(value: string): string {
  return MARKETPLACE_LABELS[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
}

const STEP_LABELS: Record<string, string> = {
  // Ingestor
  dedup: 'Dedup',
  extract: 'Extração de URL',
  blacklist: 'Blacklist',
  whitelist: 'Whitelist',
  imageFetch: 'Busca de imagem',
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
