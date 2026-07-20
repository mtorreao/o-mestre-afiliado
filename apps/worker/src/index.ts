/**
 * @omestre/worker — Background worker para processamento de links
 *
 * Funcionalidades:
 * - Escuta uma fila de URLs para conversão em lote
 * - Suporte a jobs agendados via Bun.cron
 * - Processamento de conversões em background com retry
 */

import { convertUrl } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import type { ConversionResult, Marketplace } from '@omestre/shared';

// ─── Configuração ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL || '30000', 10); // 30s
const MAX_RETRIES = parseInt(process.env.WORKER_MAX_RETRIES || '3', 10);
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);

interface QueueItem {
  id: string;
  url: string;
  marketplace?: Marketplace;
  retries: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  result?: ConversionResult;
  error?: string;
  createdAt: string;
}

// ─── Fila em memória ──────────────────────────────────────────────────────

const queue: QueueItem[] = [];
const isProcessing = new Set<string>();

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

// ─── Processamento ─────────────────────────────────────────────────────────

export function enqueue(url: string, marketplace?: Marketplace): string {
  const id = crypto.randomUUID();
  const item: QueueItem = {
    id,
    url,
    marketplace,
    retries: 0,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  queue.push(item);
  log('info', 'URL enfileirada', { id, url, marketplace });
  return id;
}

export function getQueueStatus(): QueueItem[] {
  return queue;
}

async function processItem(item: QueueItem): Promise<void> {
  if (isProcessing.has(item.id)) return;
  isProcessing.add(item.id);

  item.status = 'processing';

  try {
    log('info', 'Processando URL', { id: item.id, url: item.url });
    const result = await convertUrl(item.url);
    item.result = result;
    item.status = result.success ? 'done' : 'failed';

    if (result.success) {
      log('info', 'URL convertida com sucesso', {
        id: item.id,
        url: item.url,
        affiliateUrl: result.affiliateUrl,
        method: result.method,
      });
    } else {
      log('warn', 'Falha na conversão', {
        id: item.id,
        url: item.url,
        error: result.error,
      });
    }
  } catch (error) {
    item.error = error instanceof Error ? error.message : String(error);
    item.retries++;

    if (item.retries < MAX_RETRIES) {
      item.status = 'pending';
      log('warn', `Retry ${item.retries}/${MAX_RETRIES}`, { id: item.id, error: item.error });
    } else {
      item.status = 'failed';
      log('error', 'URL falhou após todas as tentativas', {
        id: item.id,
        url: item.url,
        error: item.error,
      });
    }
  } finally {
    isProcessing.delete(item.id);
  }
}

/**
 * Polling da fila — processa itens pendentes respeitando o limite de concorrência
 */
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

// ─── Modos de execução ──────────────────────────────────────────────────────

type WorkerMode = 'poll' | 'batch' | 'once';

function detectMode(): WorkerMode {
  if (process.argv.includes('--batch') || process.argv.includes('-b')) return 'batch';
  if (process.argv.includes('--once') || process.argv.includes('-o')) return 'once';
  return 'poll';
}

/**
 * Modo: Polling contínuo (default)
 */
async function runPolling(): Promise<void> {
  log('info', 'Worker iniciado em modo polling', {
    pollIntervalMs: POLL_INTERVAL_MS,
    maxRetries: MAX_RETRIES,
    concurrency: CONCURRENCY,
  });

  // Polling loop
  const interval = setInterval(pollQueue, POLL_INTERVAL_MS);

  // Primeira execução imediata
  await pollQueue();

  // Graceful shutdown
  const shutdown = () => {
    log('info', 'Worker desligando...');
    clearInterval(interval);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

/**
 * Modo: Batch — processa URLs passadas como argumentos e sai
 * Uso: bun run worker src/index.ts --batch "url1" "url2" "url3"
 */
async function runBatch(): Promise<void> {
  const urls = process.argv.filter((arg) => arg.startsWith('http'));

  if (urls.length === 0) {
    console.error('Uso: bun run worker --batch <url1> <url2> ...');
    process.exit(1);
  }

  log('info', 'Worker iniciado em modo batch', { urls: urls.length });

  const items = urls.map((url) => {
    const marketplace = detectMarketplace(url);
    return enqueue(url, marketplace);
  });

  // Processa todos imediatamente
  await Promise.all(items.map((id) => processItem(queue.find((q) => q.id === id)!)));

  // Exibe resultados
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   Resultados do Batch                    ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  for (const item of queue) {
    const icon = item.status === 'done' ? '✅' : '❌';
    console.log(`${icon} [${item.id.slice(0, 8)}] ${item.url}`);
    if (item.result?.affiliateUrl) {
      console.log(`   🔗 ${item.result.affiliateUrl}`);
    }
    if (item.error) {
      console.log(`   ⚠️  ${item.error}`);
    }
    console.log('');
  }

  const success = queue.filter((q) => q.status === 'done').length;
  const failed = queue.filter((q) => q.status === 'failed').length;
  console.log(`📊 Total: ${queue.length} | ✅ ${success} | ❌ ${failed}`);
}

/**
 * Modo: Once — executa uma rodada de polling e sai
 */
async function runOnce(): Promise<void> {
  log('info', 'Worker iniciado em modo once');
  await pollQueue();

  const pending = queue.filter((q) => q.status === 'pending').length;
  log('info', 'Worker finalizado', {
    total: queue.length,
    pending,
    done: queue.filter((q) => q.status === 'done').length,
    failed: queue.filter((q) => q.status === 'failed').length,
  });

  process.exit(0);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const mode = detectMode();

  switch (mode) {
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
