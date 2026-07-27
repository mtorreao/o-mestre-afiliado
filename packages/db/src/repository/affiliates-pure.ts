/**
 * Lógica PURA do repositório de afiliados (WhatsApp Worker).
 *
 * Separa o mapeamento de uma linha de afiliado para a configuração de
 * notificação (que não depende de DB) das operações de I/O. Função
 * síncrona, 100% testável sem PostgreSQL.
 */

export interface NotificationConfig {
  channel: string;
  jid: string | null;
}

/**
 * Mapeia a linha crua de um afiliado (ou null) para NotificationConfig.
 * `null` quando não há linha. Extrai `notificationChannel`/`notificationJid`
 * exatamente como o repo original.
 */
export function toNotificationConfig(
  row:
    | {
        notificationChannel: string;
        notificationJid: string | null;
      }
    | null
    | undefined,
): NotificationConfig | null {
  if (!row) return null;
  return {
    channel: row.notificationChannel,
    jid: row.notificationJid,
  };
}
