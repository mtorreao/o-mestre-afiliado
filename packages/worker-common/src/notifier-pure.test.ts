/**
 * Testes das funções PURAS do notifier (notifier-pure.ts).
 *
 * Cobrem 100% das funções de montagem de payload (URL/headers/body),
 * decisão de canal/configuração e formatação de mensagem — toda a lógica
 * que antes vivia inline dentro das funções assíncronas de I/O
 * (processFailure/notifyDirect/sendWhatsAppNotification/sendTelegramNotification)
 * e portanto não era coberta pelos testes unitários.
 */
import { describe, expect, it } from 'bun:test';
import { config } from './config.ts';
import {
  buildNotificationText,
  buildEvolutionApiUrl,
  buildEvolutionHeaders,
  buildTelegramApiUrl,
  buildWhatsAppPayload,
  buildTelegramPayload,
  resolveNotificationConfig,
  shouldSendViaChannel,
  resolveNotificationMessage,
  isGroupedReport,
  type UserFixableType,
} from './notifier-pure.ts';

describe('buildNotificationText', () => {
  it('usa formato de relatório agrupado quando total > 1', () => {
    const text = buildNotificationText('cookie_expired', 47);
    expect(text).toContain('📊 *Relatório de falhas*');
    expect(text).toContain('47 ofertas bloqueadas por cookie expirado.');
    expect(text).toContain(
      '🍪 Cookies de sessão do Mercado Livre expirados.\nReimporte os cookies pela extensão Chrome.',
    );
  });

  it('usa formato de aviso único quando total === 1', () => {
    const text = buildNotificationText('cookie_expired', 1);
    expect(text).toContain('⚠️');
    expect(text).toContain(
      '🍪 Cookies de sessão do Mercado Livre expirados.\nReimporte os cookies pela extensão Chrome.',
    );
    expect(text).not.toContain('Relatório de falhas');
  });

  it('usa formato de aviso único quando total === 0 (limite)', () => {
    const text = buildNotificationText('refresh_token_expired', 0);
    expect(text).toContain('⚠️');
    expect(text).not.toContain('Relatório de falhas');
  });

  it('usa formato de relatório agrupado quando total >= 2 (limiar é >1)', () => {
    // buildNotificationText usa `total >= 1 && total > 1`, ou seja total > 1.
    const text = buildNotificationText('cookie_expired', 2);
    expect(text).toContain('📊 *Relatório de falhas*');
    expect(text).toContain('2 ofertas bloqueadas por cookie expirado.');
  });

  it('inclui o label correto por tipo de falha', () => {
    expect(buildNotificationText('ml_account_not_linked', 5)).toContain(
      '5 ofertas bloqueadas por conta ML não vinculada.',
    );
    expect(buildNotificationText('invalid_amazon_tracking_id', 3)).toContain(
      '3 ofertas bloqueadas por tracking Amazon não configurado.',
    );
    expect(buildNotificationText('evolution_api_offline', 12)).toContain(
      '12 ofertas bloqueadas por Evolution API offline.',
    );
  });

  it('cobre todos os tipos user-fixable sem quebrar', () => {
    const types: UserFixableType[] = [
      'cookie_expired',
      'refresh_token_expired',
      'invalid_shopee_creds',
      'invalid_amazon_tracking_id',
      'ml_account_not_linked',
      'evolution_api_offline',
    ];
    for (const t of types) {
      expect(buildNotificationText(t, 99)).toContain('ofertas bloqueadas');
    }
  });
});

describe('buildEvolutionApiUrl', () => {
  it('monta a URL do endpoint sendText com a instância', () => {
    expect(buildEvolutionApiUrl('user-123')).toBe(
      'http://localhost:5444/message/sendText/user-123',
    );
  });

  it('funciona com instâncias de dispatcher', () => {
    expect(buildEvolutionApiUrl('dispatch-x')).toBe(
      'http://localhost:5444/message/sendText/dispatch-x',
    );
  });
});

describe('buildEvolutionHeaders', () => {
  it('retorna Content-Type e apikey (EVOLUTION_API_KEY da config)', () => {
    const headers = buildEvolutionHeaders();
    expect(headers['Content-Type']).toBe('application/json');
    // config é memoizado no import (loadConfig), então reflete o valor resolvido.
    expect(headers.apikey).toBe(config.EVOLUTION_API_KEY);
  });
});

describe('buildTelegramApiUrl', () => {
  it('monta a URL do Bot API com o token', () => {
    expect(buildTelegramApiUrl('SECRET')).toBe('https://api.telegram.org/botSECRET/sendMessage');
  });
});

describe('buildWhatsAppPayload', () => {
  it('serializa number/text/delay/linkPreview', () => {
    const raw = buildWhatsAppPayload('5511999999999@c.us', 'oi');
    const parsed = JSON.parse(raw);
    expect(parsed).toEqual({
      number: '5511999999999@c.us',
      text: 'oi',
      delay: 1000,
      linkPreview: false,
    });
  });
});

describe('buildTelegramPayload', () => {
  it('monta chat_id/text/parse_mode/disable_web_page_preview', () => {
    const payload = buildTelegramPayload('5511999999999', 'olá');
    expect(payload).toEqual({
      chat_id: '5511999999999',
      text: 'olá',
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  });
});

describe('resolveNotificationConfig', () => {
  it('usa channel/jid quando a config existe', () => {
    expect(resolveNotificationConfig({ channel: 'whatsapp', jid: 'a@c.us' })).toEqual({
      channel: 'whatsapp',
      jid: 'a@c.us',
    });
  });

  it('usa telegram quando a config existe', () => {
    expect(resolveNotificationConfig({ channel: 'telegram', jid: '5511' })).toEqual({
      channel: 'telegram',
      jid: '5511',
    });
  });

  it('cai no default disabled/null quando a config é null', () => {
    expect(resolveNotificationConfig(null)).toEqual({ channel: 'disabled', jid: null });
  });

  it('cai no default quando channel ausente', () => {
    expect(resolveNotificationConfig({ channel: 'disabled', jid: 'x' })).toEqual({
      channel: 'disabled',
      jid: 'x',
    });
  });

  it('mantém jid null se a config traz jid null', () => {
    expect(resolveNotificationConfig({ channel: 'whatsapp', jid: null })).toEqual({
      channel: 'whatsapp',
      jid: null,
    });
  });
});

describe('shouldSendViaChannel', () => {
  it('true quando canal habilitado e jid presente', () => {
    expect(shouldSendViaChannel('whatsapp', 'a@c.us')).toBe(true);
    expect(shouldSendViaChannel('telegram', '5511')).toBe(true);
  });

  it('false quando canal é disabled', () => {
    expect(shouldSendViaChannel('disabled', 'a@c.us')).toBe(false);
  });

  it('false quando jid é null', () => {
    expect(shouldSendViaChannel('whatsapp', null)).toBe(false);
  });

  it('false quando canal disabled E jid null', () => {
    expect(shouldSendViaChannel('disabled', null)).toBe(false);
  });

  it('true quando jid é string vazia (só null bloqueia)', () => {
    // A guarda usa `jid != null`, então string vazia NÃO bloqueia
    // (compatível com o comportamento original `!targetJid`).
    expect(shouldSendViaChannel('whatsapp', '')).toBe(true);
  });
});

describe('resolveNotificationMessage', () => {
  it('usa mensagem custom quando fornecida', () => {
    expect(resolveNotificationMessage('cookie_expired', 'msg custom')).toBe('msg custom');
  });

  it('usa mensagem padrão do tipo quando custom ausente', () => {
    expect(resolveNotificationMessage('cookie_expired')).toBe(
      '🍪 Cookies de sessão do Mercado Livre expirados.\nReimporte os cookies pela extensão Chrome.',
    );
  });

  it('usa mensagem padrão de outro tipo', () => {
    expect(resolveNotificationMessage('evolution_api_offline')).toContain('Evolution API');
  });

  it('string vazia como custom é respeitada (não cai no default)', () => {
    expect(resolveNotificationMessage('cookie_expired', '')).toBe('');
  });
});

describe('isGroupedReport', () => {
  it('true somente quando total > 1', () => {
    expect(isGroupedReport(0)).toBe(false);
    expect(isGroupedReport(1)).toBe(false);
    expect(isGroupedReport(2)).toBe(true);
    expect(isGroupedReport(47)).toBe(true);
  });
});
