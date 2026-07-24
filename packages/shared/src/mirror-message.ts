/**
 * Tipos para o pipeline de espelhamento de mensagens.
 *
 * Fluxo atual (v2):
 *   Webhook (messages.upsert) → Queue A (omestre:mirror:raw) → Ingestor → Queue B (omestre:mirror:send) → Dispatcher → Evolution API
 */

/**
 * Evento publicado na Queue A (omestre:mirror:raw) pelo webhook da API.
 * Mensagem CRUA — sem afiliado resolvido, sem link convertido.
 */
export interface RawMessageEvent {
  /** ID único da mensagem no WhatsApp */
  messageId: string;
  /** Nome da instância Evolution que recebeu (ex: "user-1") */
  instanceName: string;
  /** JID do grupo de origem */
  sourceGroupJid: string;
  /** Nome do grupo de origem */
  sourceGroupName: string;
  /** Texto extraído da mensagem */
  text: string;
  /** Timestamp da mensagem original (unix seconds) */
  timestamp: number;
}

/**
 * Evento publicado na Queue B (omestre:mirror:send) pelo Ingestor.
 * Mensagem PRONTA para envio — link já convertido, template já montado.
 */
export interface SendEvent {
  /** UUID do evento de envio */
  id: string;
  /** messageId original da mensagem fonte */
  sourceMessageId: string;
  /** sourceGroupJid original */
  sourceGroupJid: string;
  /** ID do mirror (entidade que contém targetGroup, instanceName, etc.) */
  mirrorId: number;
  /** Template de mensagem já resolvido */
  text: string;
  /** URL da imagem de capa do produto */
  imageUrl: string;
  /** Marketplace detectado */
  marketplace: string;
  /** URL original extraída */
  originalUrl: string;
  /** Link convertido para afiliado */
  convertedUrl: string;
}

/**
 * Configuração de um sourceGroup → mirror (cache 1:N).
 * Populada no startup do Ingestor e via API no save de mirrors.
 */
export interface SourceGroupConfig {
  affiliateId: number;
  mirrorId: number;
  instanceName: string;
  targetGroupJid: string;
  targetGroupName: string;
  messageTemplate: string | null;
  subRateMaxMsgs: number;
  subRateWindowSec: number;
}

/**
 * Configuração de envio resolvida pelo Dispatcher a partir do mirrorId.
 */
export interface MirrorSendConfig {
  instanceName: string;
  targetGroupJid: string;
  targetGroupName: string;
  affiliateId: number;
  status: string;
  subRateMaxMsgs: number;
  subRateWindowSec: number;
}

/**
 * Item persistido na Dead Letter Queue para mensagens com falha permanente.
 */
export interface MirrorDLQEntry {
  /** ID único do item na DLQ */
  id: string;
  /** Dados originais do evento (RawMessageEvent ou SendEvent) */
  event: RawMessageEvent | SendEvent;
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