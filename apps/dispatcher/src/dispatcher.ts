/**
 * Dispatcher — Pipeline de envio de mensagens.
 *
 * Fluxo:
 *   1. Lê SendEvent da Queue B (omestre:mirror:send)
 *   2. Dedup (send-completed Redis, 24h) — impede reenvio em crash recovery
 *   3. Busca config do mirror (instanceName, targetGroup, affiliateId, rate limit)
 *   4. Rate limit (instância + sub-rate grupo destino)
 *   5. Envia via Evolution API (sendMedia ou sendText)
 *   6. Marca send-completed e registra em reflected_offers
 *   7. ACK na Queue B
 */

import type { SendEvent, MirrorSendConfig } from '@omestre/shared';
import {
  MIRROR_SEND_COMPLETED_PREFIX,
  MIRROR_SEND_COMPLETED_TTL,
} from '@omestre/shared';
import { getDb, mirrors, affiliates, reflectedOffers } from '@omestre/db';
import { eq, and, gte } from 'drizzle-orm';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import {
  StepTracker,
  measureStep,
  incrementCounter,
  registerStepTrackers,
  setStatusMeta,
  createCounter,
} from '@omestre/worker-common';
import {
  tryAcquireSlot,
  waitForSlot,
  tryAcquireGroupSlot,
  waitForGroupSlot,
} from './rate-limiter.ts';

// ─── Config ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:5444';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

// ─── Step Trackers ───────────────────────────────────────────────────

const steps = {
  rateLimitWait: new StepTracker(),
  send: new StepTracker(),
  total: new StepTracker(),
};

// ─── Logging ─────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'dispatcher',
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── Redis ───────────────────────────────────────────────────────────

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    });
  } catch {
    return null;
  }
  return redisClient;
}

// ─── Mirror Config Resolution ───────────────────────────────────────

/**
 * Resolve a configuração de envio a partir do mirrorId.
 * O SendEvent carrega apenas o mirrorId; o Dispatcher busca a config
 * completa (instanceName, targetGroup, affiliateId, rate limits).
 *
 * Retorna null se o mirror não existir ou estiver inativo.
 */
async function getMirrorSendConfig(mirrorId: number): Promise<MirrorSendConfig | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({
        id: mirrors.id,
        status: mirrors.status,
        userId: mirrors.userId,
        targetGroups: mirrors.targetGroups,
        subRateLimitMaxMsgs: mirrors.subRateLimitMaxMsgs,
        subRateLimitWindowSec: mirrors.subRateLimitWindowSec,
      })
      .from(mirrors)
      .where(eq(mirrors.id, mirrorId))
      .limit(1);

    const m = rows[0];
    if (!m) return null;
    if (m.status === 'inactive') return null;

    // Resolve instanceName + affiliateId a partir do userId
    const userId = m.userId ?? 0;
    const affRows = await db
      .select({
        id: affiliates.id,
        evolutionInstanceId: affiliates.evolutionInstanceId,
      })
      .from(affiliates)
      .where(eq(affiliates.id, userId))
      .limit(1);

    const affiliate = affRows[0];
    const instanceName = affiliate?.evolutionInstanceId ?? `user-${userId}`;
    const affiliateId = affiliate?.id ?? userId;

    // 1 mirror = 1 targetGroup (primeiro da lista)
    const targetGroupList = (m.targetGroups as { jid: string; name: string }[]) ?? [];
    const targetGroup = targetGroupList[0] ?? { jid: '', name: '(desconhecido)' };

    return {
      instanceName,
      targetGroupJid: targetGroup.jid,
      targetGroupName: targetGroup.name,
      affiliateId,
      status: m.status,
      subRateMaxMsgs: m.subRateLimitMaxMsgs ?? 0,
      subRateWindowSec: m.subRateLimitWindowSec ?? 300,
    };
  } catch (err) {
    log('error', 'Erro ao buscar configuração do mirror', {
      mirrorId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ─── Send ────────────────────────────────────────────────────────────

function evolutionHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

/**
 * Envia via Evolution API (sendMedia com imagem, sendText sem).
 * Retry: 3 tentativas, backoff 2s/4s/8s.
 */
async function sendMediaOrText(
  instanceName: string,
  groupJid: string,
  text: string,
  imageUrl: string,
): Promise<boolean> {
  const maxAttempts = 3;
  const delays: number[] = [2_000, 4_000, 8_000];

  const endpoint = imageUrl
    ? `${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`
    : `${EVOLUTION_API_URL}/message/sendText/${instanceName}`;

  const body = imageUrl
    ? {
        number: groupJid,
        media: imageUrl,
        mediatype: 'image' as const,
        caption: text,
        delay: 2000,
      }
    : { number: groupJid, text, delay: 2000, linkPreview: true };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: evolutionHeaders(),
        body: JSON.stringify(body),
      });

      if (res.ok) {
        return true;
      }

      const responseText = await res.text();

      if (attempt === maxAttempts) {
        log('error', 'Falha ao enviar mensagem após todas as tentativas', {
          instanceName,
          groupJid,
          status: res.status,
          body: responseText.slice(0, 500),
          attempts: attempt,
        });
        return false;
      }

      log('warn', 'Falha ao enviar mensagem, tentando novamente', {
        instanceName,
        groupJid,
        status: res.status,
        attempt,
        nextRetryMs: delays[attempt - 1],
      });
    } catch (err) {
      if (attempt === maxAttempts) {
        log('error', 'Erro ao enviar mensagem após todas as tentativas', {
          instanceName,
          groupJid,
          error: err instanceof Error ? err.message : String(err),
          attempts: attempt,
        });
        return false;
      }

      log('warn', 'Erro ao enviar mensagem, tentando novamente', {
        instanceName,
        groupJid,
        error: err instanceof Error ? err.message : String(err),
        attempt,
        nextRetryMs: delays[attempt - 1],
      });
    }

    await sleep(delays[attempt - 1]!);
  }

  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Log ─────────────────────────────────────────────────────────────

async function logReflectedOffer(params: {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string | null;
  marketplace: string;
  messagePreview: string;
  status: 'sent' | 'failed' | 'blocked';
  failureReason?: string;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(reflectedOffers).values({
      affiliateId: params.affiliateId,
      sourceGroupJid: params.sourceGroupJid,
      targetGroupJid: params.targetGroupJid,
      originalLink: params.originalLink,
      convertedLink: params.convertedLink ?? params.originalLink,
      marketplace: params.marketplace as 'shopee' | 'mercadolivre' | 'amazon' | 'unknown',
      messagePreview: params.messagePreview.slice(0, 500),
      status: params.status,
      failureReason: params.failureReason ?? null,
    });
  } catch (err) {
    log('error', 'Erro ao registrar reflected_offer', {
      error: String(err),
      ...params,
    });
  }
}

// ─── Pipeline Principal ──────────────────────────────────────────────

export async function processSendEvent(event: SendEvent): Promise<boolean> {
  const { mirrorId, sourceMessageId, text, imageUrl, sourceGroupJid } = event;
  const totalStart = performance.now();

  // ── 0. Dedup atômico: já enviamos esta mensagem para este mirror? ──
  // SET NX EX é atômico no Redis — só um consumer de todo o batch consegue
  // reservar a chave, bloqueando duplicatas paralelas (read-then-write
  // permitia N cópias passarem antes da 1ª escrita).
  // Reserva ANTES de chamar Evolution: se o envio falhar, a chave fica
  // reservada até o TTL — mais barato que reprocessar e duplicar.
  const r = getRedis();
  const dedupKey = `${MIRROR_SEND_COMPLETED_PREFIX}${mirrorId}:${sourceMessageId}`;
  if (r) {
    const reserved = await r.set(dedupKey, '1', 'EX', MIRROR_SEND_COMPLETED_TTL, 'NX');
    if (reserved !== 'OK') {
      log('info', 'SendEvent já processado — pulando (dedup atômico)', {
        mirrorId,
        sourceMessageId,
        eventId: event.id,
      });
      incrementCounter('sender_messages_skipped_total', { reason: 'deduplicated' });
      return true;
    }
  }

  // ── 1. Busca config do mirror ──
  const mirror = await getMirrorSendConfig(mirrorId);
  if (!mirror) {
    log('info', 'Mirror desativado ou não encontrado — mensagem descartada', { mirrorId });
    incrementCounter('sender_messages_skipped_total', { reason: 'mirror_inactive' });
    if (r) {
      await r.setex(
        `${MIRROR_SEND_COMPLETED_PREFIX}${mirrorId}:${sourceMessageId}`,
        MIRROR_SEND_COMPLETED_TTL,
        '1',
      );
    }
    return true;
  }

  const { instanceName, targetGroupJid, targetGroupName, affiliateId, subRateMaxMsgs, subRateWindowSec } = mirror;

  if (!targetGroupJid) {
    log('warn', 'Mirror sem targetGroup configurado — descartado', { mirrorId });
    incrementCounter('sender_messages_skipped_total', { reason: 'no_target_group' });
    return true;
  }

  // ── 2. Rate limit (instância) ──
  const { acquired } = await tryAcquireSlot(instanceName);
  if (!acquired) {
    const gotSlot = await measureStep(steps.rateLimitWait, () => waitForSlot(instanceName));
    if (!gotSlot) {
      log('error', 'Rate limit da instância — timeout ao aguardar slot', {
        instanceName,
        targetGroupJid,
      });
      incrementCounter('sender_failures_total', { type: 'rate_limited', marketplace: event.marketplace });
      return false;
    }
  }

  // ── 3. Sub-rate limit (grupo destino) ──
  if (subRateMaxMsgs > 0) {
    const { acquired: subAcquired, waitMs: subWaitMs } = await tryAcquireGroupSlot(
      targetGroupJid,
      subRateMaxMsgs,
      subRateWindowSec,
    );
    if (!subAcquired) {
      const gotSlot = await measureStep(steps.rateLimitWait, () =>
        waitForGroupSlot(targetGroupJid, subRateMaxMsgs, subRateWindowSec),
      );
      if (!gotSlot) {
        log('error', 'Sub-rate limit do grupo — timeout ao aguardar slot', {
          targetGroupJid,
          mirrorId,
        });
        incrementCounter('sender_failures_total', { type: 'group_rate_limited', marketplace: event.marketplace });
        return false;
      }
    }
  }

  // ── 4. Envia via Evolution API ──
  const sent = await measureStep(steps.send, () =>
    sendMediaOrText(instanceName, targetGroupJid, text, imageUrl),
  );

  // Dedup já foi reservado atomicamente no passo 0 (SET NX EX).
  // Não precisa re-marcar aqui — a chave expira sozinha via TTL.

  // ── 5. Log no banco ──
  await logReflectedOffer({
    affiliateId,
    sourceGroupJid,
    targetGroupJid,
    originalLink: event.originalUrl,
    convertedLink: event.convertedUrl,
    marketplace: event.marketplace,
    messagePreview: text,
    status: sent ? 'sent' : 'failed',
  });

  if (sent) {
    incrementCounter('sender_messages_sent_total', { marketplace: event.marketplace });
    if (imageUrl) incrementCounter('sender_messages_sent_with_image_total');
    log('info', 'Mensagem enviada com sucesso', {
      mirrorId,
      instanceName,
      targetGroupJid,
      sourceMessageId,
    });
  } else {
    incrementCounter('sender_failures_total', { type: 'send_failed', marketplace: event.marketplace });
    log('error', 'Falha ao enviar mensagem', {
      mirrorId,
      instanceName,
      targetGroupJid,
      sourceMessageId,
    });
  }

  const totalDuration = performance.now() - totalStart;
  steps.total.observe(totalDuration);

  return sent;
}

// ─── Init ────────────────────────────────────────────────────────────

export function initMetrics(): void {
  registerStepTrackers(steps);

  createCounter('sender_events_received_total', 'SendEvents recebidos da Queue B');
  createCounter('sender_messages_sent_total', 'Mensagens enviadas com sucesso', ['marketplace']);
  createCounter('sender_messages_sent_with_image_total', 'Mensagens enviadas com imagem');
  createCounter('sender_messages_skipped_total', 'Mensagens descartadas sem enviar', ['reason']);
  createCounter('sender_failures_total', 'Falhas de envio', ['type', 'marketplace']);
}