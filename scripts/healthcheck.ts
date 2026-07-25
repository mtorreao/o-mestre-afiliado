/**
 * Healthcheck — verifica se o espelhamento está realmente funcionando.
 *
 * Detecta dois cenários que você não veria pelos logs:
 *  1. sendEventsCount zerado por N horas (pipeline "vivo" mas nada sai)
 *  2. Mensagens bloqueadas em massa por motivo específico (credenciais
 *     expiradas, Amazon sem tracking, ML offline, etc.)
 *
 * Uso:
 *   bun run scripts/healthcheck.ts                  # status atual
 *   bun run scripts/healthcheck.ts --alert          # envia Telegram se problema
 *   bun run scripts/healthcheck.ts --window 24      # janela em horas (default 1)
 *
 * Exit codes:
 *   0 — saudável (pipeline publicou algo na janela)
 *   1 — alerta (0 envios ou muitos bloqueios)
 *   2 — erro técnico (métricas indisponíveis)
 */

import { parsePromCounter } from '../packages/worker-common/src/metrics-parser.ts';

const INGESTOR_URL = process.env.HEALTHCHECK_INGESTOR_URL || 'http://localhost:9092';
const DISPATCHER_URL = process.env.HEALTHCHECK_DISPATCHER_URL || 'http://localhost:9093';
const API_KEY = process.env.METRICS_API_KEY || '';

const args = process.argv.slice(2);
const ALERT_MODE = args.includes('--alert');
const windowArg = args.indexOf('--window');
const WINDOW_HOURS = windowArg !== -1 ? parseInt(args[windowArg + 1] || '1', 10) : 1;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.HEALTHCHECK_TELEGRAM_CHAT_ID || '';

// ─── Tipos ────────────────────────────────────────────────────────────────

type MetricSnapshot = {
  pipeline_messages_received_total: number;
  pipeline_messages_processed_total: number;
  pipeline_send_events_published_total: number;
  pipeline_messages_blocked_total: Map<string, number>;
};

type AlertReason =
  | { kind: 'zero_publishes'; details: string }
  | { kind: 'high_block_rate'; details: string }
  | { kind: 'metrics_unavailable'; details: string };

// ─── Fetch helpers ────────────────────────────────────────────────────────

async function fetchMetrics(url: string): Promise<string> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;

  const res = await fetch(`${url}/metrics`, { headers });
  if (!res.ok) {
    throw new Error(`${url}/metrics → HTTP ${res.status}`);
  }
  return res.text();
}

function parseAllCounters(text: string): MetricSnapshot {
  const received = parsePromCounter(text, 'pipeline_messages_received_total');
  const processed = parsePromCounter(text, 'pipeline_messages_processed_total');
  const published = parsePromCounter(text, 'pipeline_send_events_published_total');

  const blocked = new Map<string, number>();
  for (const match of text.matchAll(
    /^pipeline_messages_blocked_total\{reason="([^"]+)"\}\s+(\d+(?:\.\d+)?)$/gm,
  )) {
    const reason = match[1]!;
    const value = parseFloat(match[2]!);
    blocked.set(reason, (blocked.get(reason) || 0) + value);
  }

  return {
    pipeline_messages_received_total: received,
    pipeline_messages_processed_total: processed,
    pipeline_send_events_published_total: published,
    pipeline_messages_blocked_total: blocked,
  };
}

// ─── State persistence (delta calculation) ────────────────────────────────

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const STATE_DIR = join(process.cwd(), 'tmp', 'healthcheck');
const STATE_FILE = join(STATE_DIR, 'last-snapshot.json');

type State = {
  timestamp: number;
  ingested: number;
  dispatched: number;
};

function loadState(): State | null {
  if (!existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as State;
  } catch {
    return null;
  }
}

function saveState(state: State): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Telegram alert ───────────────────────────────────────────────────────

async function sendTelegramAlert(
  alerts: AlertReason[],
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn(
      '[healthcheck] TELEGRAM_BOT_TOKEN/HEALTHCHECK_TELEGRAM_CHAT_ID não configurados — pulando alerta',
    );
    return false;
  }

  const lines: string[] = [];
  for (const a of alerts) {
    if (a.kind === 'zero_publishes') {
      lines.push(`🚨 *Zero envios nas últimas ${WINDOW_HOURS}h*\n${a.details}`);
    } else if (a.kind === 'high_block_rate') {
      lines.push(`⚠️ *Bloqueios em massa*\n${a.details}`);
    } else if (a.kind === 'metrics_unavailable') {
      lines.push(`📡 *Métricas indisponíveis*\n${a.details}`);
    }
  }

  const text =
    `🔔 *Healthcheck — O Mestre Afiliado*\n\n` +
    lines.join('\n\n') +
    `\n\n_Janela: ${WINDOW_HOURS}h — ${new Date().toISOString()}_`;

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });

  if (!res.ok) {
    console.warn(`[healthcheck] Telegram alert falhou: ${res.status}`);
    return false;
  }
  console.log('[healthcheck] Alerta Telegram enviado');
  return true;
}

// ─── Detecção ─────────────────────────────────────────────────────────────

const CRITICAL_BLOCK_REASONS = new Set([
  'invalid_shopee_creds',
  'invalid_amazon_tracking_id',
  'cookie_expired',
  'refresh_token_expired',
  'evolution_api_offline',
  'conversion_failed',
  'affiliate_link_mismatch',
]);

function detectAlerts(
  deltaIngestor: number,
  deltaDispatcher: number,
  blockedReasons: Map<string, number>,
): AlertReason[] {
  const alerts: AlertReason[] = [];

  // Zero publishes: ingestor processou mas dispatcher não enviou nada
  if (deltaIngestor > 0 && deltaDispatcher === 0) {
    alerts.push({
      kind: 'zero_publishes',
      details:
        `Ingestor processou ${deltaIngestor} mensagem(ns) na janela, ` +
        `mas Dispatcher não publicou nenhuma. ` +
        `Provável: credenciais inválidas, sourceGroups vazios, ou filtros.`,
    });
  }

  // Bloqueios em massa por motivo crítico: ≥ 80% das mensagens recebidas
  // bloqueadas por um motivo de credencial/integração (NÃO filtros intencionais)
  const totalBlocked = [...blockedReasons.values()].reduce((a, b) => a + b, 0);
  for (const [reason, count] of blockedReasons.entries()) {
    if (!CRITICAL_BLOCK_REASONS.has(reason)) continue;

    const threshold = Math.max(5, Math.floor(deltaIngestor * 0.5));
    if (count >= threshold && count >= 3) {
      const pct = totalBlocked > 0 ? Math.round((count / totalBlocked) * 100) : 0;
      alerts.push({
        kind: 'high_block_rate',
        details:
          `${count} mensagens bloqueadas por \`${reason}\` ` +
          `(${pct}% dos bloqueios) em ${WINDOW_HOURS}h. ` +
          `Provável causa raiz: credenciais inválidas ou serviço offline.`,
      });
    }
  }

  return alerts;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const now = Date.now();
  console.log(
    `[healthcheck] Verificando pipeline (janela: ${WINDOW_HOURS}h, alert: ${ALERT_MODE})...`,
  );

  // Fetch metrics
  let ingestorText: string;
  let dispatcherText: string;
  try {
    ingestorText = await fetchMetrics(INGESTOR_URL);
    dispatcherText = await fetchMetrics(DISPATCHER_URL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[healthcheck] Falha ao buscar métricas: ${msg}`);
    if (ALERT_MODE) {
      await sendTelegramAlert([
        { kind: 'metrics_unavailable', details: msg },
      ]);
    }
    return 2;
  }

  const ingestor = parseAllCounters(ingestorText);
  const dispatcher = parseAllCounters(dispatcherText);

  // Calcular delta baseado em snapshot anterior
  const prev = loadState();
  let deltaIngestor: number;
  let deltaDispatcher: number;

  if (prev && now - prev.timestamp < WINDOW_HOURS * 3600_000 + 600_000) {
    // Reuse snapshot if dentro da janela + 10min de tolerância
    deltaIngestor = Math.max(
      0,
      ingestor.pipeline_messages_processed_total - prev.ingested,
    );
    deltaDispatcher = Math.max(
      0,
      dispatcher.pipeline_send_events_published_total - prev.dispatched,
    );
  } else {
    // Snapshot novo (sem histórico utilizável) → não alerta, só reporta
    deltaIngestor = ingestor.pipeline_messages_processed_total;
    deltaDispatcher = dispatcher.pipeline_send_events_published_total;
    console.log(
      '[healthcheck] Sem snapshot anterior utilizável — mostrando totais absolutos',
    );
  }

  // Save novo snapshot
  saveState({
    timestamp: now,
    ingested: ingestor.pipeline_messages_processed_total,
    dispatched: dispatcher.pipeline_send_events_published_total,
  });

  // Report
  console.log('');
  console.log('=== ESTADO ATUAL ===');
  console.log(`Ingestor:`);
  console.log(`  Recebidas:   ${ingestor.pipeline_messages_received_total}`);
  console.log(`  Processadas: ${ingestor.pipeline_messages_processed_total}`);
  console.log(`Dispatcher:`);
  console.log(`  Publicadas:  ${dispatcher.pipeline_send_events_published_total}`);
  console.log(`Bloqueios por motivo:`);
  if (ingestor.pipeline_messages_blocked_total.size === 0) {
    console.log(`  (nenhum)`);
  } else {
    for (const [reason, count] of [...ingestor.pipeline_messages_blocked_total.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      console.log(`  ${reason.padEnd(28)} ${count}`);
    }
  }
  console.log('');
  console.log(`=== DELTA (${WINDOW_HOURS}h) ===`);
  console.log(`  Ingestor processadas: ${deltaIngestor}`);
  console.log(`  Dispatcher publicadas: ${deltaDispatcher}`);

  // Detectar problemas
  const alerts = detectAlerts(
    deltaIngestor,
    deltaDispatcher,
    ingestor.pipeline_messages_blocked_total,
  );

  if (alerts.length === 0) {
    console.log('');
    console.log('✅ Pipeline saudável.');
    return 0;
  }

  console.log('');
  console.log(`❌ ${alerts.length} alerta(s) detectado(s):`);
  for (const a of alerts) {
    console.log(`  - [${a.kind}] ${a.details}`);
  }

  if (ALERT_MODE) {
    await sendTelegramAlert(alerts);
  }

  return 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error('[healthcheck] Erro fatal:', err);
    process.exit(2);
  },
);