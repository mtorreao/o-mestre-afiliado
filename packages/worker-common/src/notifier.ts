/**
 * Notifier — Sistema de notificações proativas com delivery real.
 *
 * Extraído de apps/worker/src/notifier.ts para @omestre/worker-common.
 * Compartilhado entre Ingestor e Dispatcher.
 *
 * FILOSOFIA: Só notificar o que o USUÁRIO pode corrigir.
 *
 * Tipos que GERAM notificação (user-fixable):
 *   - cookie_expired           → 'Reimporte os cookies pela extensão Chrome'
 *   - refresh_token_expired    → 'Reconecte sua conta ML'
 *   - invalid_shopee_creds     → 'Verifique credenciais Shopee'
 *   - ml_account_not_linked    → 'Conecte-se primeiro'
 *   - evolution_api_offline    → 'Evolution API está offline — verifique o container'
 *
 * Tipos que NUNCA geram notificação (silenciosos):
 *   - network_timeout          → transiente
 *   - dedup                    → comportamento esperado
 *   - blacklist                → configurado pelo usuário, já visível no app
 *
 * Cooldown: cada tipo tem cooldown de 1h no Redis.
 * Agrupamento: ocorrências no mesmo cooldown são acumuladas e enviadas
 * juntas na próxima janela ('47 ofertas bloqueadas por cookie expirado').
 */

import Redis from 'ioredis';
import { AffiliatesRepository } from '@omestre/db';

const affiliatesRepo = new AffiliatesRepository();

// ─── Constantes ──────────────────────────────────────────────────────────

const COOLDOWN_PREFIX = 'notifier:cooldown:';
const OCCURRENCE_PREFIX = 'notifier:occurrences:';
const DEFAULT_COOLDOWN_SECONDS = 3600;
const OCCURRENCE_WINDOW_SECONDS = 3600;
const MIN_OCCURRENCES_FOR_NOTIFICATION = 1;

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:5444';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

// ─── Tipos ───────────────────────────────────────────────────────────────

export type UserFixableType =
  | 'cookie_expired'
  | 'refresh_token_expired'
  | 'invalid_shopee_creds'
  | 'ml_account_not_linked'
  | 'evolution_api_offline';

export type SilentType =
  | 'network_timeout'
  | 'dedup'
  | 'blacklist';

export type FailureType = UserFixableType | SilentType;

const NOTIFICATION_MESSAGES: Record<UserFixableType, string> = {
  cookie_expired:
    '🍪 Cookies de sessão do Mercado Livre expirados.\n' +
    'Reimporte os cookies pela extensão Chrome.',
  refresh_token_expired:
    '🔑 Token de refresh do Mercado Livre expirado.\n' +
    'Reconecte sua conta ML.',
  invalid_shopee_creds:
    '⚠️ Credenciais da Shopee (App ID/Secret) inválidas.\n' +
    'Verifique suas credenciais no painel.',
  ml_account_not_linked:
    '🔗 Nenhuma conta do Mercado Livre vinculada.\n' +
    'Conecte-se primeiro no painel.',
  evolution_api_offline:
    '📡 Evolution API está offline.\n' +
    'Verifique se o container da Evolution API está rodando.',
};

const NOTIFICATION_LABELS: Record<UserFixableType, string> = {
  cookie_expired: 'cookie expirado',
  refresh_token_expired: 'token expirado',
  invalid_shopee_creds: 'credenciais Shopee inválidas',
  ml_account_not_linked: 'conta ML não vinculada',
  evolution_api_offline: 'Evolution API offline',
};

// ─── Redis (lazy singleton) ──────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
let redis: Redis | null = null;
let enabled = true;

function getNotifierRedis(): Redis | null {
  if (!enabled) return null;
  if (redis) return redis;

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 2) {
          enabled = false;
          return null;
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    redis.on('error', () => {
      enabled = false;
    });
  } catch {
    enabled = false;
    return null;
  }

  return redis;
}

// ─── Headers da Evolution API ────────────────────────────────────────────

function evolutionHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

// ─── Classificação ───────────────────────────────────────────────────────

export function classifyConversionError(
  marketplace: string,
  errorMessage: string,
): FailureType | null {
  const err = errorMessage.toLowerCase();

  if (marketplace === 'mercadolivre') {
    if (
      err.includes('http 40') ||
      err.includes('401') ||
      err.includes('403') ||
      err.includes('cookie') ||
      err.includes('session') ||
      err.includes('unauthorized') ||
      err.includes('não autorizado')
    ) {
      return 'cookie_expired';
    }

    if (
      err.includes('refresh') ||
      err.includes('token expirado') ||
      err.includes('invalid_grant') ||
      err.includes('expired_token')
    ) {
      return 'refresh_token_expired';
    }

    if (
      err.includes('melitat') ||
      err.includes('sem afiliado') ||
      err.includes('não vinculada') ||
      err.includes('not linked') ||
      err.includes('no affiliate')
    ) {
      return 'ml_account_not_linked';
    }
  }

  if (marketplace === 'shopee') {
    if (
      err.includes('app id') ||
      err.includes('app_id') ||
      err.includes('appid') ||
      err.includes('secret') ||
      err.includes('invalid credential') ||
      err.includes('credencial') ||
      err.includes('shopee') ||
      err.includes('forbidden') ||
      err.includes('access denied')
    ) {
      return 'invalid_shopee_creds';
    }
  }

  if (marketplace === 'amazon') {
    if (
      err.includes('tracking') ||
      err.includes('tag') ||
      err.includes('invalid')
    ) {
      return 'invalid_shopee_creds';
    }
  }

  if (
    err.includes('fetch failed') ||
    err.includes('econnrefused') ||
    err.includes('econnreset') ||
    err.includes('etimedout') ||
    err.includes('network') ||
    err.includes('timeout') ||
    err.includes('dns') ||
    err.includes('enotfound')
  ) {
    return 'evolution_api_offline';
  }

  return null;
}

export function getNotifiableType(type: FailureType): UserFixableType | null {
  const notifiable: Set<string> = new Set([
    'cookie_expired',
    'refresh_token_expired',
    'invalid_shopee_creds',
    'ml_account_not_linked',
    'evolution_api_offline',
  ]);
  return notifiable.has(type) ? (type as UserFixableType) : null;
}

// ─── Cooldown ────────────────────────────────────────────────────────────

export async function isInCooldown(
  type: UserFixableType,
  instanceName: string,
): Promise<boolean> {
  const r = getNotifierRedis();
  if (!r) return false;

  try {
    const key = `${COOLDOWN_PREFIX}${instanceName}:${type}`;
    const exists = await r.exists(key);
    return exists === 1;
  } catch {
    return false;
  }
}

export async function setCooldown(
  type: UserFixableType,
  instanceName: string,
  ttlSeconds: number = DEFAULT_COOLDOWN_SECONDS,
): Promise<void> {
  const r = getNotifierRedis();
  if (!r) return;

  try {
    const key = `${COOLDOWN_PREFIX}${instanceName}:${type}`;
    await r.setex(key, ttlSeconds, '1');
  } catch {
    // silencia
  }
}

// ─── Acumulador de ocorrências ───────────────────────────────────────────

export async function incrementOccurrence(
  type: UserFixableType,
  instanceName: string,
): Promise<number> {
  const r = getNotifierRedis();
  if (!r) return 1;

  try {
    const key = `${OCCURRENCE_PREFIX}${instanceName}:${type}`;
    const count = await r.incr(key);
    if (count === 1) {
      await r.expire(key, OCCURRENCE_WINDOW_SECONDS);
    }
    return count;
  } catch {
    return 1;
  }
}

async function getOccurrenceCount(
  type: UserFixableType,
  instanceName: string,
): Promise<number> {
  const r = getNotifierRedis();
  if (!r) return 0;

  try {
    const key = `${OCCURRENCE_PREFIX}${instanceName}:${type}`;
    const raw = await r.get(key);
    return raw ? parseInt(raw, 10) : 0;
  } catch {
    return 0;
  }
}

async function resetOccurrences(
  type: UserFixableType,
  instanceName: string,
): Promise<void> {
  const r = getNotifierRedis();
  if (!r) return;

  try {
    const key = `${OCCURRENCE_PREFIX}${instanceName}:${type}`;
    await r.del(key);
  } catch {
    // silencia
  }
}

// ─── Busca configuração de notificação ───────────────────────────────────

async function getAffiliateNotificationConfig(
  instanceName: string,
): Promise<{ channel: string; jid: string | null } | null> {
  try {
    return await affiliatesRepo.findNotificationConfig(instanceName);
  } catch {
    return null;
  }
}

// ─── Envio ───────────────────────────────────────────────────────────────

async function sendWhatsAppNotification(
  instanceName: string,
  text: string,
  targetJid?: string | null,
): Promise<boolean> {
  if (!targetJid) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'notifier',
      message: `[NOTIFICAÇÃO] ${text.replace(/\n/g, ' | ')}`,
      instanceName,
    }));
    return true;
  }

  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
      {
        method: 'POST',
        headers: evolutionHeaders(),
        body: JSON.stringify({
          number: targetJid,
          text,
          delay: 1000,
          linkPreview: false,
        }),
      },
    );

    if (res.ok) {
      console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'notifier',
        message: `Notificação enviada via WhatsApp para ${targetJid}`,
        instanceName,
      }));
      return true;
    }

    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'notifier',
      message: 'Falha ao enviar notificação WhatsApp',
      status: res.status,
      instanceName,
    }));
    return false;
  } catch (err) {
    console.warn(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'warn',
      service: 'notifier',
      message: 'Erro ao enviar notificação WhatsApp',
      error: err instanceof Error ? err.message : String(err),
      instanceName,
    }));
    return false;
  }
}

// ─── API Pública ─────────────────────────────────────────────────────────

export async function processFailure(
  instanceName: string,
  failureType: FailureType,
  context?: { marketplace?: string; count?: number },
): Promise<void> {
  const notifiableType = getNotifiableType(failureType);
  if (!notifiableType) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'debug',
      service: 'notifier',
      message: `Falha silenciosa ignorada: ${failureType}`,
      instanceName,
      ...(context ?? {}),
    }));
    return;
  }

  const total = await incrementOccurrence(notifiableType, instanceName);

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: 'debug',
    service: 'notifier',
    message: `Ocorrência registrada: ${notifiableType} (total: ${total})`,
    instanceName,
    type: notifiableType,
    totalOccurrences: total,
    ...(context ?? {}),
  }));

  const inCooldown = await isInCooldown(notifiableType, instanceName);
  if (inCooldown) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'debug',
      service: 'notifier',
      message: `Cooldown ativo para ${notifiableType} — ${total} ocorrências acumuladas`,
      instanceName,
      type: notifiableType,
      totalOccurrences: total,
    }));
    return;
  }

  const notificationConfig = await getAffiliateNotificationConfig(instanceName);
  const channel = notificationConfig?.channel ?? 'disabled';
  const targetJid = notificationConfig?.jid ?? null;

  if (channel === 'disabled' || !targetJid) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'notifier',
      message: `Notificação disponível para ${notifiableType} (${total} ocorrências) — sem canal configurado.`,
      instanceName,
      type: notifiableType,
      totalOccurrences: total,
    }));
    await setCooldown(notifiableType, instanceName);
    await resetOccurrences(notifiableType, instanceName);
    return;
  }

  const label = NOTIFICATION_LABELS[notifiableType];
  const msg = NOTIFICATION_MESSAGES[notifiableType];

  let notificationText: string;
  if (total >= MIN_OCCURRENCES_FOR_NOTIFICATION && total > 1) {
    notificationText =
      `📊 *Relatório de falhas*\n\n` +
      `${total} ofertas bloqueadas por ${label}.\n\n` +
      `${msg}`;
  } else {
    notificationText = `⚠️ ${msg}`;
  }

  let sent = false;
  if (channel === 'whatsapp') {
    sent = await sendWhatsAppNotification(instanceName, notificationText, targetJid);
  } else if (channel === 'telegram') {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'notifier',
      message: `[NOTIFICAÇÃO] Canal Telegram não implementado. Mensagem: ${notificationText.replace(/\n/g, ' | ')}`,
      instanceName,
      targetJid,
    }));
    sent = true;
  }

  if (sent) {
    await setCooldown(notifiableType, instanceName);
    await resetOccurrences(notifiableType, instanceName);
  }
}

export async function notifyDirect(
  instanceName: string,
  type: UserFixableType,
  message?: string,
): Promise<boolean> {
  const inCooldown = await isInCooldown(type, instanceName);
  if (inCooldown) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'debug',
      service: 'notifier',
      message: `Cooldown ativo para notificação direta ${type} — ignorando`,
      instanceName,
      type,
    }));
    return false;
  }

  const notificationConfig = await getAffiliateNotificationConfig(instanceName);
  const channel = notificationConfig?.channel ?? 'disabled';
  const targetJid = notificationConfig?.jid ?? null;

  if (channel === 'disabled' || !targetJid) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'notifier',
      message: `[NOTIFICAÇÃO] Notificação direta sem canal configurado: ${message ?? NOTIFICATION_MESSAGES[type]}`,
      instanceName,
      type,
    }));
    return false;
  }

  const text = message ?? NOTIFICATION_MESSAGES[type];
  let sent = false;

  if (channel === 'whatsapp') {
    sent = await sendWhatsAppNotification(instanceName, text, targetJid);
  } else if (channel === 'telegram') {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'notifier',
      message: `[NOTIFICAÇÃO] Canal Telegram não implementado. Mensagem: ${text.replace(/\n/g, ' | ')}`,
      instanceName,
      targetJid,
    }));
    sent = true;
  }

  if (sent) {
    await setCooldown(type, instanceName);
  }

  return sent;
}