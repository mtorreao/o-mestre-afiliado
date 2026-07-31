/**
 * CatalogWorker — Entrypoint.
 *
 * Conecta ao Redis, cria o consumer group da Queue C (omestre:mirror:catalog),
 * resgata PEL órfão via XAUTOCLAIM no startup, e inicia o loop XREADGROUP.
 *
 * Modo: catalog (default). Porta de métricas: METRICS_PORT (default 9094).
 * Especificação: docs/plans/historico-precos.md §8
 */

import Redis from 'ioredis';
import { MIRROR_CATALOG_STREAM, MIRROR_CATALOG_CONSUMER_GROUP, makeLogger } from '@omestre/shared';
import type { CatalogJob } from '@omestre/shared';
import {
  startMetricsServer,
  setStatusMeta,
  setQueueSizeProvider,
  pushToDLQ,
} from '@omestre/worker-common';
import { CatalogRepository, UserCredentialsRepository } from '@omestre/db';
import { processCatalogJob, initMetrics } from './catalog-worker.ts';

const log = makeLogger('catalog-worker');

// ─── Config ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const CONSUMER_NAME = 'catalog-worker-' + (process.pid || '0');
const BATCH_COUNT = 10;
const BLOCK_MS = 5000;

// ─── Redis ───────────────────────────────────────────────────────────

let redis: Redis;

function connectRedis(): Redis {
  const r = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
    lazyConnect: false,
  });

  r.on('error', (err) => {
    log('error', 'Redis connection error', { error: err.message });
  });

  return r;
}

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup(
      'CREATE',
      MIRROR_CATALOG_STREAM,
      MIRROR_CATALOG_CONSUMER_GROUP,
      '0',
      'MKSTREAM',
    );
    log(
      'info',
      'Consumer group criado: ' +
        MIRROR_CATALOG_CONSUMER_GROUP +
        ' no stream ' +
        MIRROR_CATALOG_STREAM,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('BUSYGROUP')) {
      log('info', 'Consumer group já existe: ' + MIRROR_CATALOG_CONSUMER_GROUP);
    } else {
      throw err;
    }
  }
}

// ─── XAUTOCLAIM no startup (PEL órfão) ─────────────────────────────

async function reclaimPendingEntries(): Promise<void> {
  // Mesma técnica do Dispatcher v2 (§8.4): reclama mensagens pendentes de
  // PEL órfão (consumer que crashou antes do XACK).
  const minIdleMs = 5 * 60_000;
  const batchSize = 100;
  let cursor = '0-0';
  let reclaimed = 0;
  let skipped = 0;

  try {
    while (true) {
      const result = (await redis.xautoclaim(
        MIRROR_CATALOG_STREAM,
        MIRROR_CATALOG_CONSUMER_GROUP,
        CONSUMER_NAME,
        minIdleMs,
        cursor,
        'COUNT',
        batchSize,
      )) as [string, Array<[string, string[]]>, string[]] | null;

      if (!result || !Array.isArray(result)) break;

      const nextCursor = result[0] ?? '0-0';
      const entries = result[1] ?? [];
      cursor = nextCursor;

      for (const [messageId, fields] of entries) {
        const payload = fields[fields.indexOf('payload') + 1];
        if (!payload) {
          await redis.xack(MIRROR_CATALOG_STREAM, MIRROR_CATALOG_CONSUMER_GROUP, messageId);
          continue;
        }

        try {
          const job = JSON.parse(payload) as CatalogJob;
          const processed = await processCatalogJob(job, {
            repo: new CatalogRepository(),
            credentialsRepo: new UserCredentialsRepository(),
          });
          if (processed) {
            await redis.xack(MIRROR_CATALOG_STREAM, MIRROR_CATALOG_CONSUMER_GROUP, messageId);
            reclaimed++;
          } else {
            skipped++;
          }
        } catch (err) {
          log('error', 'Erro ao processar entrada órfã', {
            messageId,
            error: err instanceof Error ? err.message : String(err),
          });
          skipped++;
        }
      }

      if (cursor === '0-0') break;
    }

    if (reclaimed > 0 || skipped > 0) {
      log('info', 'XAUTOCLAIM no startup concluído', { reclaimed, skipped, minIdleMs });
    }
  } catch (err) {
    log('error', 'Erro no XAUTOCLAIM no startup', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── DLQ ────────────────────────────────────────────────────────────

async function sendToDLQ(job: CatalogJob, messageId: string, error: unknown): Promise<void> {
  const msg = error instanceof Error ? error.message : String(error);
  log('error', 'CatalogJob falhou — enviando para DLQ', {
    productKey: job.productKey,
    messageId,
    error: msg,
  });

  await pushToDLQ({
    event: job,
    failureReason: 'catalog_processing_failed',
    attempts: 1,
    lastError: msg,
    marketplace: job.marketplace,
    originalUrl: job.resolvedUrl,
  });
}

// ─── Main loop ───────────────────────────────────────────────────────

async function mainLoop(): Promise<void> {
  log('info', 'CatalogWorker iniciado — aguardando jobs da Queue C', {
    stream: MIRROR_CATALOG_STREAM,
    consumerGroup: MIRROR_CATALOG_CONSUMER_GROUP,
    consumerName: CONSUMER_NAME,
    batchCount: BATCH_COUNT,
    blockMs: BLOCK_MS,
  });

  const repo = new CatalogRepository();
  const credentialsRepo = new UserCredentialsRepository();

  while (true) {
    try {
      const results = (await redis.xreadgroup(
        'GROUP',
        MIRROR_CATALOG_CONSUMER_GROUP,
        CONSUMER_NAME,
        'COUNT',
        BATCH_COUNT,
        'BLOCK',
        BLOCK_MS,
        'STREAMS',
        MIRROR_CATALOG_STREAM,
        '>',
      )) as [string, Array<[string, string[]]>][] | null;

      if (!results) continue;

      for (const [_streamName, messages] of results) {
        if (!messages || messages.length === 0) continue;

        for (const [messageId, fields] of messages) {
          const payload = fields[fields.indexOf('payload') + 1];
          if (!payload) {
            await redis.xack(MIRROR_CATALOG_STREAM, MIRROR_CATALOG_CONSUMER_GROUP, messageId);
            continue;
          }

          try {
            const job = JSON.parse(payload) as CatalogJob;
            await processCatalogJob(job, { repo, credentialsRepo });
            // Sucesso e descarte (sem dado útil) são ambos ACK
            await redis.xack(MIRROR_CATALOG_STREAM, MIRROR_CATALOG_CONSUMER_GROUP, messageId);
          } catch (err) {
            // Falha real — DLQ + ACK (nunca trava a fila; spec §8.2)
            try {
              const job = JSON.parse(payload) as CatalogJob;
              await sendToDLQ(job, messageId, err);
            } catch (dlqErr) {
              log('error', 'Falha ao enviar para DLQ', {
                messageId,
                error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
              });
            }
            await redis.xack(MIRROR_CATALOG_STREAM, MIRROR_CATALOG_CONSUMER_GROUP, messageId);
          }
        }
      }
    } catch (err) {
      log('error', 'Erro no loop principal', {
        error: err instanceof Error ? err.message : String(err),
      });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ─── Graceful shutdown ───────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  log('info', 'Recebido ' + signal + ' — iniciando graceful shutdown');

  try {
    if (redis) {
      await redis.quit();
    }
  } catch {
    // silencia
  }

  log('info', 'Shutdown completo');
  process.exit(0);
}

// ─── Startup ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('info', 'CatalogWorker starting...', { pid: process.pid });

  initMetrics();
  startMetricsServer('catalog-worker', MIRROR_CATALOG_STREAM);
  setStatusMeta({ mode: 'catalog' });
  setQueueSizeProvider(async () => {
    try {
      return await redis.xlen(MIRROR_CATALOG_STREAM);
    } catch {
      return null;
    }
  });

  redis = connectRedis();
  await ensureConsumerGroup();
  await reclaimPendingEntries();

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await mainLoop();
}

main().catch((err) => {
  log('error', 'Fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
