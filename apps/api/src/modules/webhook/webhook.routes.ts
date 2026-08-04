/**
 * Webhook routes — recebe eventos da Evolution API.
 *
 * A Evolution API envia POST para /webhook/message
 * quando ocorrem eventos como:
 *   - messages.upsert  (nova mensagem recebida)
 *   - connection.update (estado da conexão mudou)
 *   - qrcode.updated    (novo QR code gerado)
 *   - groups.upsert     (entrou em grupo)
 *   - group-participants.update (participante entrou/saiu)
 *
 * Autenticação:
 *   - Se OMA_WEBHOOK_SECRET estiver configurado (produção), valida o header
 *     `Authorization: Bearer <jwt>` — JWT HS256 assinado pela Evolution API
 *     usando `jwt_key` (ver webhook-jwt-pure.ts).
 *   - Fallback LEGACY (apenas durante migração, se OMA_WEBHOOK_SECRET vazio):
 *     valida o header `apikey` contra EVOLUTION_API_KEY. A Evolution v2.3.7
 *     inclui `apikey` no BODY (não no header) por default; o header `apikey`
 *     só é enviado em integrações custom. Este fallback será removido quando
 *     a migração estiver completa.
 */

import { Elysia } from 'elysia';
import { WhatsAppInstanceRepository } from '@omestre/db';
import {
  MIRROR_RAW_STREAM,
  MIRROR_WEBHOOK_DEDUP_PREFIX,
  MIRROR_WEBHOOK_DEDUP_TTL,
} from '@omestre/shared';
import type { RawMessageEvent } from '@omestre/shared';
import { streamAdd, cacheGet, cacheSet, cacheDel } from '../../services/redis.ts';
import { getSourceGroupInfo, cacheSourceGroup } from '../../services/group-cache.ts';
import { verifyEvolutionWebhookJwt } from './webhook-jwt-pure.ts';

const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const OMA_WEBHOOK_SECRET = process.env.OMA_WEBHOOK_SECRET || '';

const instanceRepo = new WhatsAppInstanceRepository();

/** Comparação constant-time para evitar timing attacks na API key. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

interface WebhookEvent {
  event: string;
  instance?: string;
  data: unknown;
}

interface WebhookMessage {
  key: {
    id: string;
    remoteJid: string;
    fromMe: boolean;
    participant?: string;
  };
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    // Mídia com caption no primeiro nível (Evolution v2 envia imageMessage
    // diretamente para mensagens de imagem sem ephemeral wrapper)
    imageMessage?: { caption?: string };
    videoMessage?: { caption?: string };
    documentMessage?: { caption?: string };
    audioMessage?: { caption?: string };
    ephemeralMessage?: {
      message?: {
        imageMessage?: { caption?: string };
        videoMessage?: { caption?: string };
        documentMessage?: { caption?: string };
        conversation?: string;
        extendedTextMessage?: { text?: string };
      };
    };
  };
  messageTimestamp?: number;
  pushName?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Extrai o userId do instanceName (formato "user-{userId}").
 */
function extractUserIdFromInstanceName(instanceName: string): number | null {
  const match = instanceName.match(/^user-(\d+)$/);
  return match ? parseInt(match[1]!, 10) : null;
}

/**
 * Extrai o texto de uma mensagem lidando com diferentes formatos.
 */
function extractMessageText(msg: WebhookMessage['message']): string | null {
  if (!msg) return null;

  // Texto direto
  if (msg.conversation) return msg.conversation;

  // Extended text
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;

  // Mídia com caption no primeiro nível (Evolution v2 envia imageMessage
  // diretamente para mensagens de imagem sem ephemeral)
  if (msg.imageMessage?.caption) return msg.imageMessage.caption;
  if (msg.videoMessage?.caption) return msg.videoMessage.caption;
  if (msg.documentMessage?.caption) return msg.documentMessage.caption;
  if (msg.audioMessage?.caption) return msg.audioMessage?.caption ?? null;

  // Ephemeral messages (mensagens temporárias/disappearing)
  const ephemeral = msg.ephemeralMessage;
  if (ephemeral?.message) {
    const inner = ephemeral.message;
    if (inner.imageMessage?.caption) return inner.imageMessage.caption;
    if (inner.videoMessage?.caption) return inner.videoMessage.caption;
    if (inner.documentMessage?.caption) return inner.documentMessage.caption;
    if (inner.conversation) return inner.conversation;
    if (inner.extendedTextMessage?.text) return inner.extendedTextMessage.text;
  }

  return null;
}

/**
 * Processa eventos de conexão (connection.update).
 */
async function handleConnectionUpdate(
  instanceName: string,
  data: { state?: string; statusReason?: number },
): Promise<void> {
  let mappedStatus: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  if (data.state === 'open') mappedStatus = 'connected';
  else if (data.state === 'connecting') mappedStatus = 'connecting';

  const userId = extractUserIdFromInstanceName(instanceName);
  if (!userId) return;

  const instance = await instanceRepo.findByUserId(userId);
  if (!instance) return;

  if (instance.status !== mappedStatus) {
    await instanceRepo.updateStatus(instance.id, mappedStatus);
  }
}

/**
 * Processa mensagens recebidas (messages.upsert).
 *
 * Para cada mensagem de grupo (remoteJid terminando em @g.us) que
 * NÃO foi enviada pelo próprio bot (fromMe=false), extrai o texto,
 * valida contra o cache Redis de sourceGroups e publica um RawMessageEvent
 * CRU (sem afiliado resolvido) na Queue A (omestre:mirror:raw).
 *
 * O dedup de webhook ocorre AQUI (global, não por instância) para evitar
 * que múltiplas instâncias no mesmo grupo_publiquem RawMessageEvents duplicados.
 */
async function handleMessagesUpsert(
  instanceName: string,
  messages: unknown[],
): Promise<{ published: number; ignored: number }> {
  let published = 0;
  let ignored = 0;

  for (const raw of messages) {
    const msg = raw as WebhookMessage;

    // Ignora mensagens enviadas pelo próprio bot
    if (msg.key?.fromMe) {
      ignored++;
      continue;
    }

    // Só processa mensagens de grupos
    const remoteJid = msg.key?.remoteJid ?? '';
    if (!remoteJid.endsWith('@g.us')) {
      ignored++;
      continue;
    }

    // Extrai texto da mensagem
    const text = extractMessageText(msg.message);
    if (!text || text.length === 0 || text.length > 5000) {
      ignored++;
      continue;
    }

    // Busca no cache Redis se este grupo é um sourceGroup configurado.
    // Decisão de publicar/ignorar fica no cache (com fallback PG em miss).
    // O nome do grupo vem SÓ do cache — a resolução via Evolution API
    // foi desacoplada para o ingestor (opção B) para não bloquear o
    // caminho quente do webhook em I/O externo.
    const info = await getSourceGroupInfo(remoteJid);
    if (!info) {
      ignored++;
      continue;
    }
    const { affiliateId, mirrorId, groupName } = info;

    // Nome do grupo: do cache (sem chamar Evolution no hot path).
    const resolvedGroupName = groupName ?? '';

    // ── Dedup de webhook (global, 30s) ──
    // Evita RawMessageEvent duplicado quando múltiplas instâncias
    // (no mesmo grupo fonte) disparam o webhook para a mesma mensagem.
    const messageId = msg.key.id;
    const dedupKey = `${MIRROR_WEBHOOK_DEDUP_PREFIX}${remoteJid}:${messageId}`;
    const alreadySeen = await cacheGet<string>(dedupKey);
    if (alreadySeen) {
      console.log(
        `[webhook] Mensagem ${messageId} já publicada na Queue A (dedup) — ignorada (instância=${instanceName})`,
      );
      ignored++;
      continue;
    }
    await cacheSet(dedupKey, '1', MIRROR_WEBHOOK_DEDUP_TTL);

    // Publica RawMessageEvent CRU na Queue A — sem affiliateId/mirrorId
    const event: RawMessageEvent = {
      messageId,
      instanceName,
      sourceGroupJid: remoteJid,
      sourceGroupName: resolvedGroupName ?? '',
      text,
      timestamp: msg.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };

    const id = await streamAdd(MIRROR_RAW_STREAM, event);
    if (id) {
      published++;
      console.log(
        `[webhook] RawMessageEvent ${messageId} publicado na Queue A ` +
          `(grupo="${resolvedGroupName}", instância=${instanceName}, streamId=${id})`,
      );
    } else {
      console.warn(
        `[webhook] Redis indisponível — mensagem ${messageId} não publicada ` +
          `(grupo="${resolvedGroupName}", instância=${instanceName})`,
      );
      ignored++;
    }
  }

  return { published, ignored };
}

/**
 * Extrai lista de mensagens do data recebido no webhook,
 * lidando com os diferentes formatos da Evolution API v2:
 * 1. Array direto: [msg1, msg2, ...]
 * 2. Objeto com array: { messages: [msg1, msg2, ...] }
 * 3. Objeto paginado: { messages: { records: [msg1, msg2, ...] } }
 * 4. Objeto único (Evolution v2.3.7+): { key: {...}, message: {...} }
 */
function extractMessagesFromData(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data as unknown[];
  }

  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;

    // Formato paginado: { messages: { records: [...], total, pages } }
    if (Array.isArray((obj.messages as Record<string, unknown>)?.records)) {
      return (obj.messages as Record<string, unknown>).records as unknown[];
    }

    // Formato com array direto: { messages: [...] }
    if (Array.isArray(obj.messages)) {
      return obj.messages as unknown[];
    }

    // Formato objeto único (Evolution v2.3.7+):
    // messages.upsert envia data como { key: {...}, message: {...} }
    // Detectamos pela presença de key.remoteJid
    if (obj.key && typeof obj.key === 'object') {
      return [data];
    }
  }

  return [];
}

// ─── Routes ──────────────────────────────────────────────────────────

export const webhookRoutes = new Elysia()

  // ─── POST /webhook/message ──────────────────────────────────────────
  .post(
    '/webhook/message',
    async ({ body, request, set }) => {
      // Validação de autenticação via JWT (produção) ou apikey legacy (migração)
      if (!OMA_WEBHOOK_SECRET && !EVOLUTION_API_KEY) {
        console.warn(
          '🚨 Nenhum secret de webhook configurado (OMA_WEBHOOK_SECRET ou EVOLUTION_API_KEY) — rejeitando webhook',
        );
        set.status = 503;
        return { success: false, error: 'Webhook desabilitado. Configure OMA_WEBHOOK_SECRET.' };
      }

      if (OMA_WEBHOOK_SECRET) {
        // Modo produção: JWT HS256 via Authorization: Bearer
        const authHeader = request.headers.get('authorization') ?? '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) {
          console.warn('🔒 Webhook rejeitado: Authorization Bearer ausente');
          set.status = 401;
          return { success: false, error: 'Unauthorized' };
        }
        const result = await verifyEvolutionWebhookJwt(token, OMA_WEBHOOK_SECRET);
        if (!result.ok) {
          console.warn(`🔒 Webhook rejeitado: ${result.reason}`);
          set.status = 401;
          return { success: false, error: 'Unauthorized' };
        }
      } else {
        // Fallback legacy (migração): valida apikey contra EVOLUTION_API_KEY
        const providedKey = request.headers.get('apikey');
        if (!providedKey || !safeEqual(providedKey, EVOLUTION_API_KEY)) {
          console.warn(`🔒 Webhook rejeitado: apikey inválida (tem=${Boolean(providedKey)})`);
          set.status = 401;
          return { success: false, error: 'Unauthorized' };
        }
      }

      const payload = body as WebhookEvent;
      const { event, instance: instanceName, data } = payload;

      console.log(`📩 Webhook recebido: event=${event} instance=${instanceName}`);

      switch (event) {
        case 'connection.update': {
          await handleConnectionUpdate(
            instanceName ?? '',
            data as { state?: string; statusReason?: number },
          );
          break;
        }

        case 'messages.upsert': {
          const messageList = extractMessagesFromData(data);
          const result = await handleMessagesUpsert(instanceName ?? '', messageList);
          console.log(
            `📨 ${result.published} mensagem(ns) adicionada(s) ao stream, ${result.ignored} ignorada(s) em ${instanceName}`,
          );
          break;
        }

        case 'qrcode.updated': {
          console.log(`📱 QR code atualizado para ${instanceName}`);
          break;
        }

        case 'groups.upsert': {
          console.log(`👥 Grupo(s) atualizado(s) em ${instanceName}`);
          // Invalida cache da listagem de grupos para forçar recarga
          if (instanceName) {
            await cacheDel(`whatsapp:groups:${instanceName}`);
            console.log(`🔄 Cache de grupos invalidado para ${instanceName} (groups.upsert)`);
          }
          break;
        }

        case 'group-participants.update': {
          console.log(`👤 Participante atualizado em ${instanceName}`);
          break;
        }

        default: {
          console.log(`📡 Evento não mapeado: ${event}`);
        }
      }

      // Sempre retorna 200 para confirmar recebimento
      return { success: true };
    },
    {
      detail: {
        summary: 'Webhook da Evolution API',
        description:
          'Recebe eventos da Evolution API (messages.upsert, connection.update, qrcode.updated, etc.)',
      },
    },
  );
