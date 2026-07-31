/**
 * Lógica PURA do notifier (notifier.ts).
 *
 * Separa a montagem de payloads e as DECISÕES de canal/configuração da
 * camada de I/O (Redis, Evolution API, Telegram). Todas as funções aqui
 * são síncronas, determinísticas e 100% testáveis sem rede/Redis.
 *
 * O I/O (fetch/Redis) fica em `notifier.ts`, que consome este módulo.
 *
 * Funções extraídas de dentro das funções assíncronas que antes eram
 * inline e portanto não-cobertas pelos testes unitários:
 *   - buildEvolutionApiUrl        → URL do endpoint sendText
 *   - buildEvolutionHeaders       → headers da Evolution API (apikey)
 *   - buildTelegramApiUrl         → URL do endpoint sendMessage
 *   - buildWhatsAppPayload        → body do POST sendText (Evolution)
 *   - buildTelegramPayload        → body do POST sendMessage (Telegram)
 *   - resolveNotificationConfig   → decide channel/jid a partir da config
 *   - shouldSendViaChannel        → gate "canal habilitado + jid presente"
 *   - resolveNotificationMessage  → mensagem direta (custom ou padrão)
 *   - isGroupedReport             → limiar de agrupamento (total > 1)
 *
 * Os mapas de mensagem/label são duplicados localmente (em vez de importar
 * de notifier.ts) para manter este módulo livre de import circular e de
 * dependências de I/O.
 */

import { config } from './config.ts';

// ─── Tipos (espelho de notifier.ts) ──────────────────────────────────────

export type UserFixableType =
  | 'cookie_expired'
  | 'refresh_token_expired'
  | 'invalid_shopee_creds'
  | 'invalid_amazon_tracking_id'
  | 'ml_account_not_linked'
  | 'magalu_account_not_linked'
  | 'evolution_api_offline';

export type SilentType = 'network_timeout' | 'dedup' | 'blacklist';

export type FailureType = UserFixableType | SilentType;

export type NotificationChannel = 'whatsapp' | 'telegram' | 'disabled';

export interface AffiliateNotificationConfig {
  channel: string;
  jid: string | null;
}

// ─── Mensagens e labels (espelho de notifier.ts) ─────────────────────────

export const NOTIFICATION_MESSAGES: Record<UserFixableType, string> = {
  cookie_expired:
    '🍪 Cookies de sessão do Mercado Livre expirados.\n' +
    'Reimporte os cookies pela extensão Chrome.',
  refresh_token_expired:
    '🔑 Token de refresh do Mercado Livre expirado.\n' + 'Reconecte sua conta ML.',
  invalid_shopee_creds:
    '⚠️ Credenciais da Shopee (App ID/Secret) inválidas.\n' +
    'Verifique suas credenciais no painel.',
  invalid_amazon_tracking_id:
    '🛒 Tracking ID da Amazon não configurado.\n' +
    'Cadastre seu tracking ID no painel para receber comissões de ofertas Amazon.',
  ml_account_not_linked:
    '🔗 Nenhuma conta do Mercado Livre vinculada.\n' + 'Conecte-se primeiro no painel.',
  magalu_account_not_linked:
    '🛍️ Afiliado Magalu sem slug configurado.\n' +
    'Configure seu slug da loja em Configurações → Magalu.',
  evolution_api_offline:
    '📡 Evolution API está offline.\n' + 'Verifique se o container da Evolution API está rodando.',
};

export const NOTIFICATION_LABELS: Record<UserFixableType, string> = {
  cookie_expired: 'cookie expirado',
  refresh_token_expired: 'token expirado',
  invalid_shopee_creds: 'credenciais Shopee inválidas',
  invalid_amazon_tracking_id: 'tracking Amazon não configurado',
  ml_account_not_linked: 'conta ML não vinculada',
  magalu_account_not_linked: 'afiliado Magalu sem slug',
  evolution_api_offline: 'Evolution API offline',
};

/**
 * Monta o texto da notificação a partir do tipo de falha e do total de
 * ocorrências acumuladas.
 *
 * Extraída de `notifier.ts` (buildNotificationText) para este módulo puro
 * para centralizar a formatação e permitir reuso por `processFailure`/
 * `notifyDirect`. Regra de agrupamento: total > 1 → relatório agrupado.
 * Caso contrário → aviso único "⚠️ {mensagem}".
 */
export function buildNotificationText(type: UserFixableType, total: number): string {
  const label = NOTIFICATION_LABELS[type];
  const msg = NOTIFICATION_MESSAGES[type];

  if (total >= 1 && total > 1) {
    return (
      `📊 *Relatório de falhas*\n\n` + `${total} ofertas bloqueadas por ${label}.\n\n` + `${msg}`
    );
  }
  return `⚠️ ${msg}`;
}

// ─── URL / Headers / Payloads (Evolution + Telegram) ─────────────────────

/** URL do endpoint sendText da Evolution API para uma instância. */
export function buildEvolutionApiUrl(instanceName: string): string {
  return `${config.EVOLUTION_API_URL}/message/sendText/${instanceName}`;
}

/** Headers da Evolution API (apikey obrigatório). */
export function buildEvolutionHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: config.EVOLUTION_API_KEY,
  };
}

/** URL do endpoint sendMessage do Telegram Bot API (usa token de env). */
export function buildTelegramApiUrl(botToken: string): string {
  return `https://api.telegram.org/bot${botToken}/sendMessage`;
}

/** Body do POST sendText da Evolution API. */
export function buildWhatsAppPayload(targetJid: string, text: string): string {
  return JSON.stringify({
    number: targetJid,
    text,
    delay: 1000,
    linkPreview: false,
  });
}

/** Body do POST sendMessage do Telegram. */
export function buildTelegramPayload(
  chatId: string,
  text: string,
): { chat_id: string; text: string; parse_mode: string; disable_web_page_preview: boolean } {
  return {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
  };
}

// ─── Decisão de canal / configuração (pura) ──────────────────────────────

/**
 * Resolve o canal e o jid de destino a partir da configuração do afiliado.
 *
 * Se a configuração é null (repo falhou), cai no default 'disabled' com jid
 * null — comportamento idêntico ao `?? 'disabled'` / `?? null` do caller.
 * Função PURO.
 */
export function resolveNotificationConfig(config: AffiliateNotificationConfig | null): {
  channel: string;
  jid: string | null;
} {
  return {
    channel: config?.channel ?? 'disabled',
    jid: config?.jid ?? null,
  };
}

/**
 * Decide se a notificação pode ser enviada via canal habilitado.
 *
 * Verdadeiro somente quando o canal NÃO é 'disabled' E há um jid de destino.
 * Espelha a guarda `if (channel === 'disabled' || !targetJid)` invertida.
 * Função PURO.
 */
export function shouldSendViaChannel(channel: string, jid: string | null): boolean {
  return channel !== 'disabled' && jid != null;
}

/**
 * Resolve a mensagem a ser enviada numa notificação direta (notifyDirect):
 * usa a mensagem custom (quando fornecida) ou a mensagem padrão do tipo.
 *
 * Função PURO.
 */
export function resolveNotificationMessage(type: UserFixableType, customMessage?: string): string {
  return customMessage ?? NOTIFICATION_MESSAGES[type];
}

/**
 * Decide se um total de ocorrências atinge o limiar de relatório agrupado
 * (usado por buildNotificationText). total > 1 → agrupado.
 *
 * Extraída para documentar/testar o limiar isoladamente. Função PURO.
 */
export function isGroupedReport(total: number): boolean {
  return total > 1;
}
