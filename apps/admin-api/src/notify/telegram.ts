/**
 * Notificações via Telegram — reusa lógica pura de worker-common.
 *
 * `buildTelegramApiUrl` e `buildTelegramPayload` vêm de
 * `@omestre/worker-common` (notifier-pure.ts), evitando duplicação.
 */

import { buildTelegramApiUrl, buildTelegramPayload } from '@omestre/worker-common';
import type { Logger } from '../config.ts';

export interface TelegramSender {
  send(text: string): Promise<boolean>;
}

/** Envia mensagem pro chat configurado. Retorna false sem throw. */
export function makeTelegramSender(botToken: string, chatId: string, log: Logger): TelegramSender {
  return {
    async send(text: string): Promise<boolean> {
      if (!botToken || !chatId) {
        log.warn('telegram não configurado', { chatId: chatId || '(empty)' });
        return false;
      }
      try {
        const res = await fetch(buildTelegramApiUrl(botToken), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildTelegramPayload(chatId, text)),
        });
        if (res.ok) {
          log.info('notificação telegram enviada', { chatId });
          return true;
        }
        const body = await res.text();
        log.warn('falha telegram', { status: res.status, body: body.slice(0, 200) });
        return false;
      } catch (err) {
        log.warn('erro telegram', {
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      }
    },
  };
}
