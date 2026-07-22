/**
 * Notifier — Sistema de notificações acionáveis para o mirror pipeline.
 *
 * FILOSOFIA: Só notificar o que o USUÁRIO pode corrigir.
 *
 * Tipos que GERAM notificação (user-fixable):
 *   - cookie_expired           → 'Reimporte os cookies pela extensão Chrome'
 *   - refresh_token_expired    → 'Reconecte sua conta ML'
 *   - invalid_shopee_creds     → 'Verifique credenciais Shopee'
 *   - ml_account_not_linked    → 'Conecte-se primeiro'
 *
 * Tipos que NUNCA geram notificação (silenciosos):
 *   - evolution_api_offline    → transiente, usuário não corrige
 *   - network_timeout          → transiente
 *   - dedup                    → comportamento esperado
 *   - blacklist                → configurado pelo usuário, já visível no app
 *
 * Cooldown: cada tipo tem cooldown de 1h no Redis.
 * Agrupamento: ocorrências no mesmo cooldown são acumuladas e enviadas
 * juntas na próxima janela ('47 ofertas bloqueadas por cookie expirado').
 *
 * Canal: mensagem privada WhatsApp via Evolution API (para o JID configurado).
 */

import Redis from 'ioredis';

// ─── Constantes ──────────────────────────────────────────────────────────

/** Prefixos das chaves Redis */
const COOLDOWN_PREFIX = 'notifier:cooldown:';
const OCCURRENCE_PREFIX = 'notifier:occurrences:';

/** Cooldown padrão entre notificações do mesmo tipo (1 hora) */
const DEFAULT_COOLDOWN_SECONDS = 3600;

/** Janela de acumulação de ocorrências (1 hora) */
const OCCURRENCE_WINDOW_SECONDS = 3600;

/** Threshold mínimo para enviar notificação agrupada */
const MIN_OCCURRENCES_FOR_NOTIFICATION = 1;

/** JID para onde enviar as notificações (configurável via env) */
const NOTIFICATION_TARGET_JID = process.env.NOTIFICATION_TARGET_JID || '';
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:5444';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

// ─── Tipos de notificação ────────────────────────────────────────────────

/**
 * Tipos de problema que o USUÁRIO pode corrigir.
 * Estes geram notificações.
 */
export type UserFixableType =
  | 'cookie_expired'            // Cookies de sessão ML expirados
  | 'refresh_token_expired'     // Refresh token ML expirado
  | 'invalid_shopee_creds'      // Shopee App ID/Secret inválido
  | 'ml_account_not_linked';    // Conta ML não vinculada ao usuário

/**
 * Tipos de problema que SÃO SILENCIOSOS (nunca geram notificação).
 */
export type SilentType =
  | 'evolution_api_offline'
  | 'network_timeout'
  | 'dedup'
  | 'blacklist';

/** Todos os tipos de falha */
export type FailureType = UserFixableType | SilentType;

/** Mensagens amigáveis para cada tipo de notificação */
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
};

/** Labels curtas para usar em mensagens agrupadas */
const NOTIFICATION_LABELS: Record<UserFixableType, string> = {
  cookie_expired: 'cookie expirado',
  refresh_token_expired: 'token expirado',
  invalid_shopee_creds: 'credenciais Shopee inválidas',
  ml_account_not_linked: 'conta ML não vinculada',
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

/**
 * Classifica um erro de conversão em um tipo de notificação.
 * Retorna null se o erro não é classificável.
 *
 * Examina a mensagem de erro para determinar a causa raiz.
 */
export function classifyConversionError(
  marketplace: string,
  errorMessage: string,
): FailureType | null {
  const err = errorMessage.toLowerCase();

  // ── Mercado Livre ──────────────────────────────────────────────────
  if (marketplace === 'mercadolivre') {
    // Cookie expirado
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

    // Refresh token expirado
    if (
      err.includes('refresh') ||
      err.includes('token expirado') ||
      err.includes('invalid_grant') ||
      err.includes('expired_token')
    ) {
      return 'refresh_token_expired';
    }

    // Conta não vinculada (sem melitat)
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

  // ── Shopee ─────────────────────────────────────────────────────────
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

  // ── Amazon ─────────────────────────────────────────────────────────
  if (marketplace === 'amazon') {
    if (
      err.includes('tracking') ||
      err.includes('tag') ||
      err.includes('invalid')
    ) {
      return 'invalid_shopee_creds';
    }
  }

  // ── Erros de rede / Evolution ──────────────────────────────────────
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
    return null; // Silencioso — não classifica como notificável
  }

  // Qualquer outro erro é genérico — não notifica
  return null;
}

/**
 * Verifica se um tipo de falha gera notificação.
 * Se sim, retorna o tipo de notificação; se não, retorna null.
 */
export function getNotifiableType(type: FailureType): UserFixableType | null {
  const notifiable: Set<string> = new Set([
    'cookie_expired',
    'refresh_token_expired',
    'invalid_shopee_creds',
    'ml_account_not_linked',
  ]);
  return notifiable.has(type) ? (type as UserFixableType) : null;
}

// ─── Cooldown ────────────────────────────────────────────────────────────

/**
 * Verifica se está dentro do período de cooldown para um tipo de notificação.
 * Retorna true se ainda está em cooldown (não deve notificar).
 */
export async function isInCooldown(
  type: UserFixableType,
  instanceName: string,
): Promise<boolean> {
  const r = getNotifierRedis();
  if (!r) return false; // Sem Redis → sem cooldown (notifica sempre)

  try {
    const key = `${COOLDOWN_PREFIX}${instanceName}:${type}`;
    const exists = await r.exists(key);
    return exists === 1;
  } catch {
    return false;
  }
}

/**
 * Define o cooldown para um tipo de notificação.
 */
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

/**
 * Incrementa o contador de ocorrências para um tipo.
 * Retorna o novo total de ocorrências na janela atual.
 */
export async function incrementOccurrence(
  type: UserFixableType,
  instanceName: string,
): Promise<number> {
  const r = getNotifierRedis();
  if (!r) return 1;

  try {
    const key = `${OCCURRENCE_PREFIX}${instanceName}:${type}`;
    const count = await r.incr(key);
    // Define TTL na primeira inserção (se count === 1, acabou de criar)
    if (count === 1) {
      await r.expire(key, OCCURRENCE_WINDOW_SECONDS);
    }
    return count;
  } catch {
    return 1;
  }
}

/**
 * Lê o contador atual de ocorrências sem incrementar.
 */
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

/**
 * Reseta o contador de ocorrências (após enviar notificação).
 */
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

// ─── Envio de notificações ───────────────────────────────────────────────

/**
 * Envia uma notificação via Evolution API (mensagem privada WhatsApp).
 *
 * O destino é configurado via env NOTIFICATION_TARGET_JID.
 * Se não configurado, notifica via log apenas.
 */
async function sendWhatsAppNotification(
  instanceName: string,
  text: string,
): Promise<boolean> {
  if (!NOTIFICATION_TARGET_JID) {
    // Sem JID configurado → apenas loga
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'notifier',
        message: `[NOTIFICAÇÃO] ${text.replace(/\n/g, ' | ')}`,
        instanceName,
      }),
    );
    return true;
  }

  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
      {
        method: 'POST',
        headers: evolutionHeaders(),
        body: JSON.stringify({
          number: NOTIFICATION_TARGET_JID,
          text,
          delay: 1000,
          linkPreview: false,
        }),
      },
    );

    if (res.ok) {
      console.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: 'info',
          service: 'notifier',
          message: `Notificação enviada via WhatsApp para ${NOTIFICATION_TARGET_JID}`,
          instanceName,
        }),
      );
      return true;
    }

    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'notifier',
        message: `Falha ao enviar notificação WhatsApp`,
        status: res.status,
        instanceName,
      }),
    );
    return false;
  } catch (err) {
    console.warn(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        service: 'notifier',
        message: `Erro ao enviar notificação WhatsApp`,
        error: err instanceof Error ? err.message : String(err),
        instanceName,
      }),
    );
    return false;
  }
}

// ─── API Pública ─────────────────────────────────────────────────────────

/**
 * Processa uma falha no pipeline e decide se deve notificar.
 *
 * Fluxo:
 *   1. Classifica a falha → tipo
 *   2. Se for silenciosa → ignora (log apenas)
 *   3. Incrementa contador de ocorrências
 *   4. Se está em cooldown → não notifica agora (ocorrências acumulam)
 *   5. Se cooldown expirou → envia notificação com total acumulado
 *
 * @param instanceName  Nome da instância Evolution (ex: "user-1")
 * @param failureType   Tipo da falha (já classificado)
 * @param context       Contexto adicional (marketplace, count individual)
 */
export async function processFailure(
  instanceName: string,
  failureType: FailureType,
  context?: { marketplace?: string; count?: number },
): Promise<void> {
  // 1. Verifica se é um tipo notificável
  const notifiableType = getNotifiableType(failureType);
  if (!notifiableType) {
    // Tipo silencioso — só log
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'debug',
        service: 'notifier',
        message: `Falha silenciosa ignorada: ${failureType}`,
        instanceName,
        ...(context ?? {}),
      }),
    );
    return;
  }

  // 2. Incrementa contagem de ocorrências
  const total = await incrementOccurrence(notifiableType, instanceName);

  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'debug',
      service: 'notifier',
      message: `Ocorrência registrada: ${notifiableType} (total: ${total})`,
      instanceName,
      type: notifiableType,
      totalOccurrences: total,
      ...(context ?? {}),
    }),
  );

  // 3. Verifica cooldown
  const inCooldown = await isInCooldown(notifiableType, instanceName);
  if (inCooldown) {
    // Ainda em cooldown — ocorrências continuam acumulando
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'debug',
        service: 'notifier',
        message: `Cooldown ativo para ${notifiableType} — ${total} ocorrências acumuladas`,
        instanceName,
        type: notifiableType,
        totalOccurrences: total,
      }),
    );
    return;
  }

  // 4. Cooldown expirou — envia notificação agrupada
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

  const sent = await sendWhatsAppNotification(instanceName, notificationText);

  // 5. Se enviou com sucesso, define cooldown e reseta contagem
  if (sent) {
    await setCooldown(notifiableType, instanceName);
    await resetOccurrences(notifiableType, instanceName);
  }
}

/**
 * Envia uma notificação direta (sem acumulação) com mensagem personalizada.
 * Útil para situações urgentes que não passam pelo pipeline de falhas.
 *
 * Respeita cooldown do tipo — se estiver em cooldown, não envia.
 */
export async function notifyDirect(
  instanceName: string,
  type: UserFixableType,
  message?: string,
): Promise<boolean> {
  // Verifica cooldown
  const inCooldown = await isInCooldown(type, instanceName);
  if (inCooldown) {
    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'debug',
        service: 'notifier',
        message: `Cooldown ativo para notificação direta ${type} — ignorando`,
        instanceName,
        type,
      }),
    );
    return false;
  }

  const text = message ?? NOTIFICATION_MESSAGES[type];
  const sent = await sendWhatsAppNotification(instanceName, text);

  if (sent) {
    await setCooldown(type, instanceName);
  }

  return sent;
}
