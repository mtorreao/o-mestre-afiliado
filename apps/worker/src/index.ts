/**
 * @omestre/worker — Background worker para processamento de mensagens
 *
 * Modo:
 *   mirror (default) — Lê do Redis Stream (com consumer group) e processa espelhamento de ofertas
 *   revalidate       — Uma rodada de revalidação de grupos
 *   revalidate-daemon— Daemon de revalidação periódica
 *
 * O Redis Stream persiste mensagens e garante entrega via consumer group + ACK explícito.
 *
 * Uso:
 *   bun apps/worker/src/index.ts                     # modo mirror (default)
 *   bun apps/worker/src/index.ts --revalidate         # modo revalidate
 *   bun apps/worker/src/index.ts --revalidate-daemon  # modo revalidate-daemon
 */

import os from 'node:os';
import Redis from 'ioredis';
import { MIRROR_STREAM, MIRROR_CONSUMER_GROUP } from '@omestre/shared';
import type { MirrorMessageEvent } from '@omestre/shared';
import { getDb, AffiliatesRepository, MirrorRepository, mirrors } from '@omestre/db';
import { eq } from 'drizzle-orm';
import { processMirrorMessage } from './mirror-pipeline.ts';
import { runRevalidation, runRevalidationDaemon } from './revalidate.ts';
import { startMetricsServer, setStatusMeta } from './metrics.ts';
import { pushToDLQ, purgeOldDLQItems } from './dead-letter-queue.ts';

// ─── Constantes do cache de sourceGroups ────────────────────────────────
// (mesma estrutura do group-cache.ts na API)

const CACHE_PREFIX = 'mirror:source-group:';
const CACHE_SET_KEY = 'mirror:source-groups:all';

// ─── Configuração ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';

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
// MODO MIRROR — Pipeline de espelhamento via Redis Stream
// ═══════════════════════════════════════════════════════════════════════════

/** Nome único do consumer dentro do grupo (hostname:pid). */
function consumerName(): string {
  return `omestre:${os.hostname()}:${process.pid}`;
}

/**
 * Cria o consumer group se não existir (idempotente).
 * Usa MKSTREAM para criar o stream automaticamente.
 */
async function ensureConsumerGroup(redis: Redis): Promise<void> {
  try {
    await redis.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');
    log('info', 'Consumer group criado', {
      stream: MIRROR_STREAM,
      group: MIRROR_CONSUMER_GROUP,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // BUSYGROUP significa que o grupo já existe — é esperado
    if (msg.includes('BUSYGROUP')) {
      log('info', 'Consumer group já existe', { stream: MIRROR_STREAM, group: MIRROR_CONSUMER_GROUP });
    } else {
      log('warn', 'Falha ao criar consumer group (pode não ser fatal)', {
        stream: MIRROR_STREAM,
        error: msg,
      });
    }
  }
}

/**
 * Processa mensagens pendentes na inicialização (recuperação de workers
 * que morreram antes de fazer ACK).
 *
 * Mensagens com deliveryCount > 3 são lidas do stream e movidas para
 * a Dead Letter Queue antes de receberem ACK, garantindo que nenhum
 * payload seja perdido mesmo em caso de falha catastrófica do worker.
 */
async function processPendingMessages(redis: Redis): Promise<void> {
  try {
    const pending = await redis.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    if (!pending || pending.length === 0) return;

    log('info', `Recuperando ${pending.length} mensagens pendentes`, {});

    for (const item of pending) {
      const [msgId, consumer, idleMs, deliveryCount] = item as unknown as [string, string, number, number];
      log('info', 'Mensagem pendente encontrada', {
        msgId,
        consumer,
        idleMs,
        deliveryCount,
      });

      if (deliveryCount > 3) {
        log('warn', 'Mensagem excedeu tentativas — movendo para DLQ', { msgId });

        try {
          // Lê o conteúdo da mensagem do stream antes de fazer ACK
          const raw = await redis.xrange(
            MIRROR_STREAM,
            msgId,
            msgId,
          );

          if (raw && Array.isArray(raw) && raw.length > 0) {
            const msgEntry = raw[0] as [string, string[]];
            const fields = msgEntry[1];
            const payloadIndex = fields.indexOf('payload');
            if (payloadIndex !== -1 && payloadIndex + 1 < fields.length) {
              const rawPayload = fields[payloadIndex + 1] as string;
              try {
                const event = JSON.parse(rawPayload) as MirrorMessageEvent;
                await pushToDLQ({
                  event,
                  failureReason: 'stream_exceeded_delivery_count',
                  attempts: deliveryCount,
                  lastError: `Mensagem excedeu ${deliveryCount} tentativas de entrega no stream`,
                });
              } catch {
                log('warn', 'Payload inválido na mensagem pendente — DLQ ignorada', { msgId });
              }
            }
          }
        } catch (err) {
          log('warn', 'Erro ao ler payload da mensagem pendente para DLQ', {
            msgId,
            error: err instanceof Error ? err.message : String(err),
          });
        }

        await redis.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);
        continue;
      }
    }
  } catch (err) {
    log('warn', 'Erro ao verificar mensagens pendentes', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Popula o cache Redis com os sourceGroups configurados no banco.
 *
 * Num deploy fresh o cache está vazio → o webhook ignora tudo.
 * Esta função garante que os sourceGroups salvos no banco sejam
 * carregados para o Redis na inicialização do worker.
 *
 * Usa pipeline para atomicidade e performance.
 * Falha não é fatal — o cache é populado também via API no próximo save.
 */
async function populateSourceGroupCache(redis: Redis): Promise<void> {
  try {
    getDb(); // garante que a conexão com o banco está ativa
    const pipeline = redis.pipeline();
    let totalGroups = 0;
    let totalMirrors = 0;

    // ── 1. Carrega sourceGroups de afiliados (legado) ──────────────
    const repo = new AffiliatesRepository();
    const affiliates = await repo.findAllActiveWithSourceGroups();

    if (affiliates.length > 0) {
      log('info', `Populando cache Redis com sourceGroups de ${affiliates.length} afiliados`, {});

      for (const aff of affiliates) {
        const groups = aff.sourceGroups as { jid: string; name: string }[] | null;
        if (!groups) continue;

        for (const group of groups) {
          pipeline.set(
            `${CACHE_PREFIX}${group.jid}`,
            JSON.stringify({ affiliateId: aff.id, groupName: group.name || '' }),
          );
          pipeline.sadd(CACHE_SET_KEY, group.jid);
          totalGroups++;
        }
      }
    }

    // ── 2. Carrega sourceGroups de mirrors ativos ─────────────────
    const db = getDb();
    const activeMirrors = await db
      .select({
        id: mirrors.id,
        userId: mirrors.userId,
        sourceGroups: mirrors.sourceGroups,
      })
      .from(mirrors)
      .where(eq(mirrors.status, 'active'));

    if (activeMirrors.length > 0) {
      log('info', `Populando cache Redis com sourceGroups de ${activeMirrors.length} mirrors ativos`, {});

      for (const mirror of activeMirrors) {
        const groups = mirror.sourceGroups as { jid: string; name: string }[] | null;
        if (!groups) continue;

        // Resolve o affiliateId a partir do userId do mirror
        // O affiliate tem evolutionInstanceId = "user-{userId}"
        let mirrorAffiliateId = 0;
        if (mirror.userId) {
          try {
            const aff = await repo.findByEvolutionInstanceId(`user-${mirror.userId}`);
            if (aff) mirrorAffiliateId = aff.id;
          } catch {
            // Se não encontrar, deixa 0 (worker usa instanceName como fallback)
          }
        }

        for (const group of groups) {
          // Sobrescreve entradas legadas com o mirrorId
          pipeline.set(
            `${CACHE_PREFIX}${group.jid}`,
            JSON.stringify({
              affiliateId: mirrorAffiliateId,
              mirrorId: mirror.id,
              groupName: group.name || '',
            }),
          );
          pipeline.sadd(CACHE_SET_KEY, group.jid);
          totalGroups++;
          totalMirrors++;
        }
      }
    }

    await pipeline.exec();

    if (totalGroups === 0) {
      log('info', 'Nenhum sourceGroup configurado no banco — cache vazio', {});
    } else {
      log('info', `Cache populado com ${totalGroups} sourceGroups (${affiliates.length} afiliados + ${totalMirrors} mirrors ativos)`, {});
    }
  } catch (err) {
    // Falha ao popular cache não é fatal — o webhook só vai ignorar
    // mensagens até alguém salvar via API, que popula o cache na hora.
    log('warn', 'Falha ao popular cache Redis de sourceGroups (não fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Processa um payload de stream (campo 'payload') JSON como MirrorMessageEvent.
 */
async function handleStreamMessage(rawPayload: string, msgId: string, redis: Redis): Promise<void> {
  try {
    const event = JSON.parse(rawPayload) as MirrorMessageEvent;

    log('info', 'Mensagem recebida do stream', {
      msgId,
      messageId: event.messageId,
      sourceGroupJid: event.sourceGroupJid,
    });

    await processMirrorMessage(event);

    // Só faz ACK se processou com sucesso (ou falhou mas queremos descartar)
    await redis.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);
    log('info', 'Mensagem acknowledgeada', { msgId });
  } catch (err) {
    // Em caso de erro de parsing, acknowledge para não travar o stream
    // Em caso de erro de processamento, acknowledge também (evita loop infinito)
    const error = err instanceof Error ? err.message : String(err);
    log('error', 'Erro ao processar mensagem do stream — dando ACK mesmo assim', {
      msgId,
      error,
    });
    try {
      await redis.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);
    } catch {
      // silencia
    }
  }
}

/**
 * Modo: Mirror (default) — Lê do Redis Stream e processa mensagens de
 * grupos de espelhamento usando consumer group para resiliência.
 */
async function runMirror(): Promise<void> {
  const CONSUMER = consumerName();
  log('info', 'Worker iniciado em modo mirror (Redis Stream)', {
    redisUrl: REDIS_URL.replace(/\/\/.*@/, '//***@'),
    consumer: CONSUMER,
    stream: MIRROR_STREAM,
    group: MIRROR_CONSUMER_GROUP,
  });

  let redis: Redis | null = null;
  let running = true;

  const shutdown = async () => {
    if (!running) return;
    running = false;
    log('info', 'Worker desligando...');
    try {
      if (redis) await redis.quit();
    } catch {
      // ignore errors during shutdown
    }
    // Dá tempo para logs serem emitidos
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) {
          log('error', 'Redis falhou após 5 tentativas. Encerrando.');
          process.exit(1);
        }
        return Math.min(times * 1000, 10000);
      },
      lazyConnect: true,
    });

    await redis.connect();
    log('info', 'Conectado ao Redis');

    // ── Inicia servidor de métricas ──
    startMetricsServer();
    setStatusMeta({ mode: 'mirror' });

    // ── Popula cache de sourceGroups do banco ──
    await populateSourceGroupCache(redis);

    // ── Garante que o consumer group existe ──
    await ensureConsumerGroup(redis);

    // ── Recupera mensagens pendentes de execuções anteriores ──
    await processPendingMessages(redis);

    // ── Remove itens expirados da DLQ ──
    const purged = await purgeOldDLQItems();
    if (purged > 0) {
      log('info', `DLQ limpa — ${purged} itens antigos removidos`, {});
    }

    // ── Loop principal de consumo ──
    while (running) {
      try {
        // XREADGROUP: lê mensagens novas (>), bloqueia 5s se não houver nada
        const result = await redis.xreadgroup(
          'GROUP',
          MIRROR_CONSUMER_GROUP,
          CONSUMER,
          'COUNT',
          5,
          'BLOCK',
          5000,
          'STREAMS',
          MIRROR_STREAM,
          '>',
        );

        if (!result) {
          // Timeout (BLOCK expirou sem novas mensagens) — volta ao loop
          continue;
        }

        // result: [[streamName, [[msgId, [field, value, ...]], ...]], ...]
        const entries = result as Array<
          [string, Array<[string, string[]]>]
        >;
        for (const [, messages] of entries) {
          for (const [msgId, fields] of messages) {
            if (!running) break;

            // fields é um array alternado [key1, val1, key2, val2, ...]
            const payloadIndex = fields.indexOf('payload');
            if (payloadIndex === -1 || payloadIndex + 1 >= fields.length) {
              log('warn', 'Mensagem sem campo payload — ignorando', { msgId });
              await redis.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);
              continue;
            }

            const rawPayload = fields[payloadIndex + 1] as string;
            await handleStreamMessage(rawPayload, msgId, redis);
          }
        }
      } catch (err) {
        if (!running) break;
        log('error', 'Erro no loop de consumo do stream', {
          error: err instanceof Error ? err.message : String(err),
        });
        // Pequena pausa antes de tentar de novo para evitar loop violento
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } catch (err) {
    log('error', 'Falha ao iniciar worker mirror', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO REVALIDATION — Revalidação periódica de grupos
// ═══════════════════════════════════════════════════════════════════════════

async function runRevalidateOnce(): Promise<void> {
  log('info', 'Worker iniciado em modo revalidate (once)');
  const result = await runRevalidation();
  console.log('');
  console.log('═══════════════════════════════════════════════');
  console.log('RESUMO DA REVALIDAÇÃO:');
  console.log(`  Afiliados totais: ${result.totalAffiliates}`);
  console.log(`  Validados:        ${result.validatedAffiliates}`);
  console.log(`  Com falha nova:   ${result.failedAffiliates}`);
  console.log('═══════════════════════════════════════════════');
  for (const r of result.results) {
    const icon = r.overallPassed ? '✅' : '❌';
    const changed = r.statusChanged ? ' (⚠️ mudou de status!)' : '';
    console.log(`  ${icon} Afiliado #${r.affiliateId} (${r.evolutionInstanceId})${changed}`);
    for (const g of r.groups) {
      const gIcon = g.passed ? '✅' : '❌';
      console.log(`     ${gIcon} ${g.groupName}: ${Math.round(g.ratio * 100)}% ofertas (${g.validOffers}/${g.totalMessages})`);
    }
  }
}

async function runRevalidateDaemon(): Promise<void> {
  log('info', 'Worker iniciado em modo revalidate-daemon');
  // Inicia servidor HTTP com /metrics e /health para healthcheck de orquestrador
  startMetricsServer();
  setStatusMeta({ mode: 'revalidate-daemon' });
  await runRevalidationDaemon();
}

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

type WorkerMode = 'mirror' | 'revalidate' | 'revalidate-daemon';

function detectMode(): WorkerMode {
  if (process.argv.includes('--revalidate-daemon')) return 'revalidate-daemon';
  if (process.argv.includes('--revalidate')) return 'revalidate';
  return 'mirror'; // default
}

async function main() {
  const mode = detectMode();

  switch (mode) {
    case 'mirror':
      await runMirror();
      break;
    case 'revalidate':
      await runRevalidateOnce();
      process.exit(0);
      break;
    case 'revalidate-daemon':
      await runRevalidateDaemon();
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Exports (para testes)
// ═══════════════════════════════════════════════════════════════════════════

export { populateSourceGroupCache, CACHE_PREFIX, CACHE_SET_KEY };

// ═══════════════════════════════════════════════════════════════════════════
// Entry point — só executa quando o arquivo é rodado diretamente
// ═══════════════════════════════════════════════════════════════════════════

if (import.meta.main) {
  main();
}
