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

/**
 * Item persistido na Dead Letter Queue para mensagens com falha permanente.
 */
export interface MirrorDLQEntry {
  /** ID único do item na DLQ */
  id: string;
  /** Dados originais do evento */
  event: MirrorMessageEvent;
  /** Razão da falha */
  failureReason: string;
  /** Número de tentativas realizadas */
  attempts: number;
  /** Mensagem do último erro */
  lastError: string;
  /** Quando a falha ocorreu (ISO) */
  failedAt: string;
  /** Marketplace detectado (se aplicável) */
  marketplace?: string;
  /** URL original extraída (se aplicável) */
  originalUrl?: string;
  /** Status da conversão */
  conversionSuccess?: boolean;
  /** JIDs dos grupos de destino (se conhecidos) */
  targetGroupJids?: string[];
  /** Se já foi re-processado */
  reprocessed: boolean;
  /** Quando foi re-processado (ISO) */
  reprocessedAt?: string;
  /** Resultado do re-processamento */
  reprocessResult?: string;
}
