/**
 * @omestre/worker — Background worker para processamento de mensagens
 *
 * Modos:
 *   mirror (default) — Escuta Redis PubSub e processa espelhamento de ofertas
 *   poll             — Polling de fila em memória (legado, conversão de URLs)
 *   batch            — Processa URLs passadas como argumentos e sai
 *   once             — Uma rodada de polling e sai
 *
 * Uso:
 *   bun apps/worker/src/index.ts                # modo mirror (default)
 *   bun apps/worker/src/index.ts --batch <urls>  # modo batch
 *   bun apps/worker/src/index.ts --once          # modo once
 */

import Redis from 'ioredis';
import { MIRROR_MESSAGE_CHANNEL } from '@omestre/shared';
import type { MirrorMessageEvent } from '@omestre/shared';
import { processMirrorMessage } from './mirror-pipeline.ts';

// ─── Configuração ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL || '30000', 10);
const MAX_RETRIES = parseInt(process.env.WORKER_MAX_RETRIES || '3', 10);
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

// ─── Logging ──────────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'worker',
    message,
    ...(data ? { data } : {}),
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO MIRROR — Pipeline de espelhamento via Redis PubSub
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Modo: Mirror (default) — Escuta Redis PubSub e processa mensagens de
 * grupos de espelhamento em tempo real.
 */
async function runMirror(): Promise<void> {
  log('info', 'Worker iniciado em modo mirror', {
    redisUrl: REDIS_URL.replace(/\/\/.*@/, '//***@'),  // esconde senha
  });

  let subscriber: Redis | null = null;

  try {
    subscriber = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) {
          log('error', 'Redis subscriber falhou após 5 tentativas. Encerrando.');
          process.exit(1);
        }
        return Math.min(times * 1000, 10000);
      },
      lazyConnect: true,
    });

    await subscriber.connect();
    log('info', 'Conectado ao Redis');

    await subscriber.subscribe(MIRROR_MESSAGE_CHANNEL, (err) => {
      if (err) {
        log('error', 'Falha ao subscrever no canal', {
          channel: MIRROR_MESSAGE_CHANNEL,
          error: err.message,
        });
        return;
      }
      log('info', 'Inscrito no canal', { channel: MIRROR_MESSAGE_CHANNEL });
    });

    subscriber.on('message', async (channel, raw) => {
      if (channel !== MIRROR_MESSAGE_CHANNEL) return;

      try {
        const event = JSON.parse(raw) as MirrorMessageEvent;
        log('info', 'Nova mensagem recebida do PubSub', {
          messageId: event.messageId,
          sourceGroupJid: event.sourceGroupJid,
        });

        await processMirrorMessage(event);
      } catch (err) {
        log('error', 'Erro ao processar mensagem do PubSub', {
          raw: raw.slice(0, 500),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    log('info', 'Aguardando mensagens...');

    // Graceful shutdown
    const shutdown = async () => {
      log('info', 'Worker desligando...');
      try {
        if (subscriber) {
          await subscriber.unsubscribe(MIRROR_MESSAGE_CHANNEL);
          await subscriber.quit();
        }
      } catch {
        // ignore errors during shutdown
      }
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Mantém o processo vivo
    await new Promise(() => {});
  } catch (err) {
    log('error', 'Falha ao iniciar subscriber Redis', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO LEGACY — Fila em memória para conversão de URLs
// ═══════════════════════════════════════════════════════════════════════════

interface QueueItem {
  id: string;
  url: string;
  marketplace?: string;
  retries: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  result?: { success: boolean; affiliateUrl?: string | null; error?: string; method?: string };
  error?: string;
  createdAt: string;
}

const queue: QueueItem[] = [];
const isProcessing = new Set<string>();

function enqueue(url: string, marketplace?: string): string {
  const id = crypto.randomUUID();
  queue.push({
    id,
    url,
    marketplace,
    retries: 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  log('info', 'URL enfileirada', { id, url, marketplace });
  return id;
}

function getQueueStatus(): QueueItem[] {
  return queue;
}

async function processItem(item: QueueItem): Promise<void> {
  if (isProcessing.has(item.id)) return;
  isProcessing.add(item.id);

  item.status = 'processing';

  try {
    const { convertUrl } = await import('@omestre/converters');
    log('info', 'Processando URL', { id: item.id, url: item.url });
    const result = await convertUrl(item.url);
    item.result = result;
    item.status = result.success ? 'done' : 'failed';

    if (result.success) {
      log('info', 'URL convertida com sucesso', {
        id: item.id,
        affiliateUrl: result.affiliateUrl,
        method: result.method,
      });
    } else {
      log('warn', 'Falha na conversão', { id: item.id, error: result.error });
    }
  } catch (error) {
    item.error = error instanceof Error ? error.message : String(error);
    item.retries++;

    if (item.retries < MAX_RETRIES) {
      item.status = 'pending';
      log('warn', `Retry ${item.retries}/${MAX_RETRIES}`, { id: item.id, error: item.error });
    } else {
      item.status = 'failed';
      log('error', 'URL falhou após todas as tentativas', { id: item.id, error: item.error });
    }
  } finally {
    isProcessing.delete(item.id);
  }
}

async function pollQueue(): Promise<void> {
  const pending = queue.filter(
    (item) => item.status === 'pending' && !isProcessing.has(item.id),
  );

  const available = Math.max(0, CONCURRENCY - isProcessing.size);
  const batch = pending.slice(0, available);

  if (batch.length === 0) return;

  log('info', `Processando lote de ${batch.length} URLs`);
  await Promise.all(batch.map(processItem));
}

async function runPolling(): Promise<void> {
  log('info', 'Worker iniciado em modo polling (legado)', {
    pollIntervalMs: POLL_INTERVAL_MS,
    maxRetries: MAX_RETRIES,
    concurrency: CONCURRENCY,
  });

  const interval = setInterval(pollQueue, POLL_INTERVAL_MS);
  await pollQueue();

  const shutdown = () => {
    log('info', 'Worker desligando...');
    clearInterval(interval);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function runBatch(): Promise<void> {
  const urls = process.argv.filter((arg) => arg.startsWith('http'));

  if (urls.length === 0) {
    console.error('Uso: bun run worker --batch <url1> <url2> ...');
    process.exit(1);
  }

  log('info', 'Worker iniciado em modo batch', { urls: urls.length });

  const { convertUrl } = await import('@omestre/converters');

  for (const url of urls) {
    const result = await convertUrl(url);
    const icon = result.success ? '✅' : '❌';
    console.log(`${icon} ${url}`);
    if (result.affiliateUrl) {
      console.log(`   🔗 ${result.affiliateUrl}`);
    }
    if (result.error) {
      console.log(`   ⚠️  ${result.error}`);
    }
  }
}

async function runOnce(): Promise<void> {
  log('info', 'Worker iniciado em modo once');
  await pollQueue();
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

type WorkerMode = 'mirror' | 'poll' | 'batch' | 'once';

function detectMode(): WorkerMode {
  if (process.argv.includes('--batch') || process.argv.includes('-b')) return 'batch';
  if (process.argv.includes('--once') || process.argv.includes('-o')) return 'once';
  if (process.argv.includes('--poll') || process.argv.includes('-p')) return 'poll';
  return 'mirror'; // default
}

async function main() {
  const mode = detectMode();

  switch (mode) {
    case 'mirror':
      await runMirror();
      break;
    case 'poll':
      await runPolling();
      break;
    case 'batch':
      await runBatch();
      break;
    case 'once':
      await runOnce();
      break;
  }
}

main();
