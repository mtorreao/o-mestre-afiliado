/**
 * Tipos para o pipeline de espelhamento de mensagens.
 *
 * Fluxo:
 *   Webhook (messages.upsert) → Redis PubSub → Worker → Evolution API (sendText)
 */

/**
 * Mensagem que a API publica no Redis PubSub para o worker processar.
 */
export interface MirrorMessageEvent {
  /** ID único da mensagem no WhatsApp */
  messageId: string;
  /** Nome da instância Evolution que recebeu a mensagem (ex: "user-1") */
  instanceName: string;
  /** JID do grupo de origem (onde a oferta foi postada) */
  sourceGroupJid: string;
  /** Nome do grupo de origem */
  sourceGroupName: string;
  /** ID do afiliado no banco */
  affiliateId: number;
  /** Texto extraído da mensagem */
  text: string;
  /** Timestamp da mensagem original (unix seconds) */
  timestamp: number;
  /** Marketplace detectado (opcional, será detectado no worker) */
  marketplace?: string;
}
