/**
 * Tipos compartilhados entre a extensão Chrome e a API para envio de logs.
 *
 * A extensão envia batches para POST /api/extension/logs.
 * Auth via header X-Extension-Logs-Key (escopo apenas inserir).
 *
 * Usa `ExtensionLogLevel` (4 níveis: debug < info < warn < error) para
 * evitar colisão com `LogLevel` do logger do shared (3 níveis).
 */

export const ALLOWED_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type ExtensionLogLevel = (typeof ALLOWED_LOG_LEVELS)[number];

/** Entrada normalizada após validação no servidor. */
export interface ExtensionLogEntry {
  /** UUID da instalação — agrupa logs da mesma sessão do SW. */
  sessionId: string;
  /** Email do usuário logado no painel (se disponível). */
  userEmail: string | null;
  /** Nível: debug < info < warn < error. */
  level: ExtensionLogLevel;
  /** Nome do evento (ex: 'verify-auth.fetch.start'). */
  event: string;
  /** Payload arbitrário (max 50 chaves, valores string max 1000 chars). */
  data: Record<string, unknown> | null;
  /** Versão da extensão (ex: '1.6.0'). */
  extensionVersion: string;
  /** Versão do Chrome (ex: '120.0.6099.130'). */
  chromeVersion: string | null;
  /** User-Agent do SW. */
  userAgent: string | null;
}
