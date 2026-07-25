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

async function processOne(event: SendEvent, id: string): Promise<void> {
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
}

async function processBatch(
  messageIds: string[],
  events: SendEvent[],
): Promise<void> {
  // Agrupa eventos por mirrorId para serializar dentro do mesmo destino
  // (respeitando rate-limit por instanceName+targetGroupJid sem deadlock).
  // Mirrors distintos rodam em paralelo — preserva paralelismo entre
  // afiliados/instâncias diferentes.
  //
  // ANTES: Promise.allSettled(events.map(...)) — uma única chamada
  // travando em waitForSlot (até 5min) bloqueava o batch inteiro.
  // AGORA: serialização por mirrorId = rate-limit não trava nada além
  // do próprio destino.
  const groups = new Map<number, Array<{ event: SendEvent; id: string }>>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    const id = messageIds[i]!;
    let bucket = groups.get(event.mirrorId);
    if (!bucket) {
      bucket = [];
      groups.set(event.mirrorId, bucket);
    }
    bucket.push({ event, id });
  }

  await Promise.allSettled(
    [...groups.values()].map(async (bucket) => {
      // Serializa dentro do bucket — rate-limit é respeitado
      // e não trava batches de outros destinos
      for (const { event, id } of bucket) {
        await processOne(event, id);
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

async function reclaimPendingEntries(): Promise<void> {
  // XAUTOCLAIM reclama mensagens pendentes de PEL órfão (consumer que
  // crashou antes do XACK). Sem isso, mensagens podem ficar presas no PEL
  // indefinidamente — o XREADGROUP só entrega PEL do próprio consumer
  // (via '0'/'0' como start), então PEL órfão de consumidor morto nunca
  // é re-entregue pelo loop principal.
  //
  // Estratégia: varre o stream em batches de 100, min-idle-time=5min.
  // Mensagens com dedup-reservado (já processadas por outro consumer
  // sobrevivente) vão cair no dedup atômico e ser puladas.
  const minIdleMs = 5 * 60_000;
  const batchSize = 100;
  let cursor = '0-0';
  let reclaimed = 0;
  let skipped = 0;
  let totalDeletedIds = 0;

  try {
    while (true) {
      const result = (await redis.xautoclaim(
        MIRROR_SEND_STREAM,
        MIRROR_SEND_CONSUMER_GROUP,
        CONSUMER_NAME,
        minIdleMs,
        cursor,
        'COUNT', batchSize,
      )) as [string, Array<[string, string[]]>, string[]] | null;

      if (!result || !Array.isArray(result)) break;

      // ioredis/Redis retorna shape variável entre versões:
      // - 2 elementos: [cursor, entries]
      // - 3 elementos: [cursor, entries, deletedIds] (Redis 6.2+)
      const nextCursor = result[0] ?? '0-0';
      const entries = result[1] ?? [];
      const deletedIds = result[2] ?? [];
      cursor = nextCursor;
      totalDeletedIds += deletedIds.length;

      for (const [messageId, fields] of entries) {
        const payload = fields[fields.indexOf('payload') + 1];
        if (!payload) {
          await redis.xack(MIRROR_SEND_STREAM, MIRROR_SEND_CONSUMER_GROUP, messageId);
          continue;
        }

        try {
          const event = JSON.parse(payload) as SendEvent;
          // processSendEvent faz dedup atômico (SET NX EX) — se outro
          // consumer vivo já processou, retorna true sem enviar.
          const processed = await processSendEvent(event);
          if (processed) {
            await redis.xack(MIRROR_SEND_STREAM, MIRROR_SEND_CONSUMER_GROUP, messageId);
            reclaimed++;
          } else {
            // Processamento falhou (rate-limit, etc.) — não dá ACK para retry
            skipped++;
          }
        } catch (err) {
          console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'dispatcher',
            message: 'Erro ao processar entrada órfã',
            messageId,
            error: err instanceof Error ? err.message : String(err),
          }));
          skipped++;
        }
      }

      // Cursor '0-0' significa que o scan completou
      if (cursor === '0-0') break;
    }

    if (totalDeletedIds > 0 || reclaimed > 0 || skipped > 0) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'dispatcher',
        message: 'XAUTOCLAIM no startup concluído',
        reclaimed,
        skipped,
        deletedIds: totalDeletedIds,
        minIdleMs,
      }));
    }
  } catch (err) {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      service: 'dispatcher',
      message: 'Erro no XAUTOCLAIM no startup',
      error: err instanceof Error ? err.message : String(err),
    }));
    // Não propaga — startup continua mesmo se reclam falhar
  }
}

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
  await reclaimPendingEntries();

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