/**
 * Dispatcher — Pipeline de envio de mensagens.
 *
 * Fluxo:
 *   1. Lê SendEvent da Queue B (omestre:mirror:send)
 *   2. Dedup (send-completed Redis, 24h) — impede reenvio em crash recovery
 *   3. Busca config do mirror (mirror-config.ts)
 *   4. Rate limit (instância + sub-rate grupo destino) — rate-limiter.ts
 *   5. Envia via Evolution API (evolution-sender.ts)
 *   6. Marca send-completed e registra em reflected_offers (offer-logger.ts)
 *   7. ACK na Queue B
 *
 * Módulos auxiliares:
 *   - redis.ts:           conexão Redis singleton
 *   - mirror-config.ts:   getMirrorSendConfig() — resolve config do mirrorId
 *   - evolution-sender.ts: sendMediaOrText() — POST pra Evolution API
 *   - offer-logger.ts:    logReflectedOffer() — INSERT em reflected_offers
 *   - metrics.ts:         steps (StepTrackers) + initMetrics()
 *   - rate-limiter.ts:    tryAcquireSlot / waitForSlot / tryAcquireGroupSlot
 */

import type { SendEvent } from '@omestre/shared';
import { MIRROR_SEND_COMPLETED_PREFIX, MIRROR_SEND_COMPLETED_TTL } from '@omestre/shared';
import { measureStep, incrementCounter } from '@omestre/worker-common';
import {
  tryAcquireSlot,
  waitForSlot,
  tryAcquireGroupSlot,
  waitForGroupSlot,
} from './rate-limiter.ts';
import { getRedis } from './redis.ts';
import { getMirrorSendConfig } from './mirror-config.ts';
import { sendMediaOrText } from './evolution-sender.ts';
import { logReflectedOffer } from './offer-logger.ts';
import { steps } from './metrics.ts';

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

/**
 * Processa um SendEvent da Queue B.
 *
 * Retorna true se deve dar ACK (processada com sucesso OU descartada por
 * motivo legítimo — dedup, mirror inativo, etc.).
 * Retorna false se o pipeline precisa retentar (rate limit timeout, etc.).
 */
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

  const { instanceName, targetGroupJid, affiliateId, subRateMaxMsgs, subRateWindowSec } = mirror;

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
      incrementCounter('sender_failures_total', {
        type: 'rate_limited',
        marketplace: event.marketplace,
      });
      return false;
    }
  }

  // ── 3. Sub-rate limit (grupo destino) ──
  if (subRateMaxMsgs > 0) {
    const { acquired: subAcquired } = await tryAcquireGroupSlot(
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
        incrementCounter('sender_failures_total', {
          type: 'group_rate_limited',
          marketplace: event.marketplace,
        });
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
    incrementCounter('sender_failures_total', {
      type: 'send_failed',
      marketplace: event.marketplace,
    });
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
