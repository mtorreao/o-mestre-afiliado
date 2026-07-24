/**
 * Dispatcher — Entrypoint.
 *
 * Conecta ao Redis, cria o consumer group da Queue B (omestre:mirror:send),
 * e inicia o loop XREADGROUP processando SendEvents.
 *
 * Paralelismo: SendEvents de instâncias DIFERENTES em paralelo;
 * dentro da mesma instância, processa em série (respeitando rate limit).
 *
 * Modo: dispatcher (default). Porta de métricas: METRICS_PORT (default 9093).
 */

import Redis from 'ioredis';
import type { SendEvent } from '@omestre/shared';
import {
  MIRROR_SEND_STREAM,
  MIRROR_SEND_CONSUMER_GROUP,
} from '@omestre/shared';
import {
  startMetricsServer,
  setStatusMeta,
} from '@omestre/worker-common';
import { processSendEvent, initMetrics } from './dispatcher.ts';

// ─── Config ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const CONSUMER_NAME = `dispatcher-${process.pid || '0'}`;
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
      service: 'dispatcher',
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
      MIRROR_SEND_STREAM,
      MIRROR_SEND_CONSUMER_GROUP,
      '0',
      'MKSTREAM',
    );
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'dispatcher',
      message: `Consumer group criado: ${MIRROR_SEND_CONSUMER_GROUP} no stream ${MIRROR_SEND_STREAM}`,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('BUSYGROUP')) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'dispatcher',
        message: `Consumer group já existe: ${MIRROR_SEND_CONSUMER_GROUP}`,
      }));
    } else {
      throw err;
    }
  }
}

// ─── Processamento de lote ───────────────────────────────────────────

async function processBatch(
  messageIds: string[],
  events: SendEvent[],
): Promise<void> {
  // Cada evento é processado individualmente. O rate limiter (Redis INCR)
  // já serializa/envia em ordem por instância, então não precisamos de
  // agrupamento manual — instâncias diferentes correm em paralelo via
  // Promise.allSettled, instâncias iguais respeitam o rate limit.
  await Promise.allSettled(
    events.map(async (event, i) => {
      const id = messageIds[i]!;
      try {
        const processed = await processSendEvent(event);
        if (processed) {
          await redis.xack(MIRROR_SEND_STREAM, MIRROR_SEND_CONSUMER_GROUP, id);
        }
      } catch (err) {
        console.error(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'error',
          service: 'dispatcher',
          message: 'Erro ao processar SendEvent',
          messageId: id,
          error: err instanceof Error ? err.message : String(err),
        }));
        // Não dá ACK — será reentregue para retry
      }
    }),
  );
}

// ─── Main loop ───────────────────────────────────────────────────────

async function mainLoop(): Promise<void> {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'dispatcher',
    message: 'Dispatcher iniciado — aguardando mensagens da Queue B',
    stream: MIRROR_SEND_STREAM,
    consumerGroup: MIRROR_SEND_CONSUMER_GROUP,
    consumerName: CONSUMER_NAME,
    batchCount: BATCH_COUNT,
    blockMs: BLOCK_MS,
  }));

  while (true) {
    try {
      const results = await redis.xreadgroup(
        'GROUP', MIRROR_SEND_CONSUMER_GROUP, CONSUMER_NAME,
        'COUNT', BATCH_COUNT,
        'BLOCK', BLOCK_MS,
        'STREAMS', MIRROR_SEND_STREAM, '>',
      ) as [string, Array<[string, string[]]>][] | null;

      if (!results) continue;

      for (const [_streamName, messages] of results) {
        if (!messages || messages.length === 0) continue;

        const messageIds: string[] = [];
        const events: SendEvent[] = [];

        for (const [messageId, fields] of messages) {
          const payload = fields[fields.indexOf('payload') + 1];
          if (!payload) {
            await redis.xack(MIRROR_SEND_STREAM, MIRROR_SEND_CONSUMER_GROUP, messageId);
            continue;
          }

          try {
            const event = JSON.parse(payload) as SendEvent;
            messageIds.push(messageId);
            events.push(event);
          } catch {
            await redis.xack(MIRROR_SEND_STREAM, MIRROR_SEND_CONSUMER_GROUP, messageId);
          }
        }

        if (events.length > 0) {
          await processBatch(messageIds, events);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        service: 'dispatcher',
        message: 'Erro no loop principal',
        error: msg,
      }));
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
    service: 'dispatcher',
    message: `Recebido ${signal} — iniciando graceful shutdown`,
  }));

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
    service: 'dispatcher',
    message: 'Shutdown completo',
  }));

  process.exit(0);
}

// ─── Startup ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'info',
    service: 'dispatcher',
    message: 'Dispatcher starting...',
    pid: process.pid,
  }));

  initMetrics();
  startMetricsServer('dispatcher', MIRROR_SEND_STREAM);
  setStatusMeta({ mode: 'dispatcher' });

  redis = connectRedis();
  await ensureConsumerGroup();

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  await mainLoop();
}

main().catch((err) => {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'error',
    service: 'dispatcher',
    message: 'Fatal error',
    error: err instanceof Error ? err.message : String(err),
  }));
  process.exit(1);
});