/**
 * Testes das funções PURAS do repositório de afiliados (WhatsApp Worker).
 *
 * Cobrem o mapeamento de NotificationConfig — sem PostgreSQL.
 */
import { describe, expect, it } from 'bun:test';
import { toNotificationConfig } from './affiliates-pure.ts';

describe('toNotificationConfig', () => {
  it('mapeia channel e jid', () => {
    const cfg = toNotificationConfig({
      notificationChannel: 'whatsapp',
      notificationJid: '123@c.us',
    });
    expect(cfg).toEqual({ channel: 'whatsapp', jid: '123@c.us' });
  });

  it('preserva jid nulo', () => {
    const cfg = toNotificationConfig({
      notificationChannel: 'disabled',
      notificationJid: null,
    });
    expect(cfg).toEqual({ channel: 'disabled', jid: null });
  });

  it('retorna null quando a linha é null', () => {
    expect(toNotificationConfig(null)).toBeNull();
  });

  it('retorna null quando a linha é undefined', () => {
    expect(toNotificationConfig(undefined)).toBeNull();
  });

  it('canal vazio é preservado (sem normalização)', () => {
    const cfg = toNotificationConfig({ notificationChannel: '', notificationJid: null });
    expect(cfg!.channel).toBe('');
  });
});
