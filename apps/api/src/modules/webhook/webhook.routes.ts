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
 * A rota não requer autenticação JWT — a Evolution API
 * envia o apikey no header para validação.
 */

import { Elysia } from 'elysia';
import { WhatsAppInstanceRepository } from '@omestre/db';
import { MIRROR_STREAM } from '@omestre/shared';
import type { MirrorMessageEvent } from '@omestre/shared';
import { streamAdd, cacheDel } from '../../services/redis.ts';
import { getSourceGroupInfo, cacheSourceGroup } from '../../services/group-cache.ts';
import { fetchGroupInfo } from '../../services/evolution.ts';

const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

const instanceRepo = new WhatsAppInstanceRepository();

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

  // Ephemeral messages (mensagens temporárias)
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
 * identifica qual afiliado tem aquele grupo como sourceGroup e
 * publica no Redis PubSub para o worker processar.
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

    // Busca no cache Redis se este grupo é um sourceGroup configurado
    // (sem consulta ao PostgreSQL — apenas O(1) no Redis)
    const info = await getSourceGroupInfo(remoteJid);
    if (!info) {
      ignored++;
      continue;
    }
    const { affiliateId, groupName } = info;

    // Se o nome do grupo não está no cache, tenta buscar via Evolution API
    let resolvedGroupName = groupName;
    if (!resolvedGroupName) {
      try {
        const groupInfo = await fetchGroupInfo(instanceName, remoteJid);
        if (groupInfo?.name) {
          resolvedGroupName = groupInfo.name;
          // Atualiza o cache com o nome encontrado
          await cacheSourceGroup(remoteJid, affiliateId, resolvedGroupName);
        }
      } catch {
        // Falha silenciosa — usa nome vazio
      }
    }

    // Publica no Redis para o worker processar
    const event: MirrorMessageEvent = {
      messageId: msg.key.id,
      instanceName,
      sourceGroupJid: remoteJid,
      sourceGroupName: resolvedGroupName,
      affiliateId,
      text,
      timestamp: msg.messageTimestamp ?? Math.floor(Date.now() / 1000),
    };

    const id = await streamAdd(MIRROR_STREAM, event);
    if (id) {
      published++;
      console.log(
        `[webhook] Mensagem ${msg.key.id} adicionada ao stream ` +
        `(affiliateId=${affiliateId}, grupo="${resolvedGroupName}", instância=${instanceName}, streamId=${id})`,
      );
    } else {
      // Se Redis não está disponível, loga como ignorado
      console.warn(
        `[webhook] Redis indisponível — mensagem ${msg.key.id} não publicada ` +
        `(affiliateId=${affiliateId}, grupo="${resolvedGroupName}", instância=${instanceName})`,
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
  }

  return [];
}

// ─── Routes ──────────────────────────────────────────────────────────

export const webhookRoutes = new Elysia()

  // ─── POST /webhook/message ──────────────────────────────────────────
  .post(
    '/webhook/message',
    async ({ body, set }) => {
      void EVOLUTION_API_KEY;

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
          const result = await handleMessagesUpsert(
            instanceName ?? '',
            messageList,
          );
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
