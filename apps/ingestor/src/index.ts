/**
 * Ingestor — Entrypoint.
 *
 * Conecta ao Redis, cria o consumer group da Queue A (omestre:mirror:raw),
 * e inicia o loop XREADGROUP processando RawMessageEvents.
 *
 * Modo: ingestor (default) — lê continuamente da Queue A.
 * Porta de métricas: METRICS_PORT (default 9092).
 */

import Redis from 'ioredis';
import {
  MIRROR_RAW_STREAM,
  MIRROR_RAW_CONSUMER_GROUP,
} from '@omestre/shared';
import {
  startMetricsServer,
  setStatusMeta,
} from '@omestre/worker-common';
import { processRawMessage, initMetrics } from './ingestor.ts';
import { startMlCookieRevalidator, stopMlCookieRevalidator } from './ml-cookie-revalidator.ts';

// ─── Config ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const CONSUMER_NAME = `ingestor-${process.pid || '0'}`;
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
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'ingestor',
      message: 'Redis connection error',
      error: err.message,
    }));
  });

  return r;
}

async function ensureConsumerGroup(): Promise<void> {
  try {
    await redis.xgroup(
      'CREATE',
      MIRROR_RAW_STREAM,
      MIRROR_RAW_CONSUMER_GROUP,
      '0',
      'MKSTREAM',
    );
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'ingestor',
      message: `Consumer group criado: ${MIRROR_RAW_CONSUMER_GROUP} no stream ${MIRROR_RAW_STREAM}`,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('BUSYGROUP')) {
      // Grupo já existe — ok
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'ingestor',
        message: `Consumer group já existe: ${MIRROR_RAW_CONSUMER_GROUP}`,
      }));
    } else {
      throw err;
    }
  }
}

// ─── Main loop ───────────────────────────────────────────────────────

async function mainLoop(): Promise<void> {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'ingestor',
    message: 'Ingestor iniciado — aguardando mensagens da Queue A',
    stream: MIRROR_RAW_STREAM,
    consumerGroup: MIRROR_RAW_CONSUMER_GROUP,
    consumerName: CONSUMER_NAME,
    batchCount: BATCH_COUNT,
    blockMs: BLOCK_MS,
  }));

  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', MIRROR_RAW_CONSUMER_GROUP, CONSUMER_NAME,
        'COUNT', BATCH_COUNT,
        'BLOCK', BLOCK_MS,
        'STREAMS', MIRROR_RAW_STREAM, '>',
      );

      if (!results) continue;

      for (const [_streamName, messages] of results as [string, Array<[string, string[]]>][]) {
        if (!messages || messages.length === 0) continue;

        for (const [messageId, fields] of messages) {
          const payload = fields[fields.indexOf('payload') + 1];
          if (!payload) {
            await redis.xack(MIRROR_RAW_STREAM, MIRROR_RAW_CONSUMER_GROUP, messageId);
            continue;
          }

          try {
            const event = JSON.parse(payload);
            const processed = await processRawMessage(event);

            if (processed) {
              await redis.xack(MIRROR_RAW_STREAM, MIRROR_RAW_CONSUMER_GROUP, messageId);
            }
            // Se não processado (Redis indisponível), NÃO dá ACK — será reentregue
          } catch (err) {
            console.error(JSON.stringify({
              timestamp: new Date().toISOString(),
              level: 'error',
              service: 'ingestor',
              message: 'Erro ao processar mensagem da Queue A',
              messageId,
              error: err instanceof Error ? err.message : String(err),
            }));
            // Não dá ACK — será reentregue para retry
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'ingestor',
        message: 'Erro no loop principal',
        error: msg,
      }));
      // Aguarda antes de tentar novamente
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ─── Graceful shutdown ───────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'ingestor',
    message: `Recebido ${signal} — iniciando graceful shutdown`,
  }));

  stopMlCookieRevalidator();

  try {
    if (redis) {
      await redis.quit();
    }
  } catch {
    // silencia
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'ingestor',
    message: 'Shutdown completo',
  }));

  process.exit(0);
}

// ─── Startup ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'ingestor',
    message: 'Ingestor starting...',
    pid: process.pid,
  }));

  // Inicializa métricas
  initMetrics();
  startMetricsServer('ingestor', MIRROR_RAW_STREAM);
  setStatusMeta({ mode: 'ingestor' });

  // Conecta Redis
  redis = connectRedis();
  await ensureConsumerGroup();

  // Inicia re-validador periódico de cookies ML (background)
  startMlCookieRevalidator();

  // Registra handlers de graceful shutdown
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Inicia loop principal
  await mainLoop();
  }

main().catch((err) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'ingestor',
    message: 'Fatal error',
    error: err instanceof Error ? err.message : String(err),
  }));
  process.exit(1);
});