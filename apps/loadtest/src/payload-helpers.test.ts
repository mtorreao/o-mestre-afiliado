/**
 * Testes dos helpers puros de payload (payload-helpers.ts).
 *
 * Sem I/O — apenas validade determinística e shape dos payloads.
 */
import { describe, expect, it } from 'bun:test';
import {
  makeEmail,
  makePassword,
  buildAuthRegister,
  buildAuthLogin,
  buildAuthRefresh,
  buildSecondaryWebhookEvent,
  buildAffiliateProfileUpdate,
  buildTestConversionPayload,
  buildMalformedWebhook,
  buildIgnoredWebhook,
} from './payload-helpers.ts';

describe('makeEmail', () => {
  it('formata com userId', () => {
    expect(makeEmail(3)).toBe('loadtest-u3@omestre.local');
  });
  it('userId 0 funciona', () => {
    expect(makeEmail(0)).toBe('loadtest-u0@omestre.local');
  });
});

describe('makePassword', () => {
  it('tem pelo menos 7 chars e mix de classes', () => {
    const p = makePassword(1);
    expect(p.length).toBeGreaterThanOrEqual(7);
    expect(/[A-Z]/.test(p)).toBe(true);
    expect(/[a-z]/.test(p)).toBe(true);
    expect(/[0-9]/.test(p)).toBe(true);
    expect(/[^A-Za-z0-9]/.test(p)).toBe(true);
  });
  it('é determinística para a mesma seed', () => {
    expect(makePassword(42)).toBe(makePassword(42));
  });
  it('seeds diferentes geram senhas diferentes (provavelmente)', () => {
    expect(makePassword(1)).not.toBe(makePassword(2));
  });
});

describe('buildAuthRegister', () => {
  it('retorna email/name/password', () => {
    const r = buildAuthRegister(7, 100);
    expect(r.email).toBe('loadtest-u7@omestre.local');
    expect(r.name).toContain('Load Test User');
    expect(r.password.length).toBeGreaterThanOrEqual(7);
  });
});

describe('buildAuthLogin', () => {
  it('usa o mesmo email da seed', () => {
    expect(buildAuthLogin(2, 200).email).toBe('loadtest-u2@omestre.local');
  });
});

describe('buildAuthRefresh', () => {
  it('encapsula o token', () => {
    expect(buildAuthRefresh('tok-abc')).toEqual({ refreshToken: 'tok-abc' });
  });
});

describe('buildSecondaryWebhookEvent', () => {
  it('connection.update: state open|connecting', () => {
    const ev = buildSecondaryWebhookEvent('connection.update', 'user-1', 5);
    expect(ev.event).toBe('connection.update');
    expect(ev.instance).toBe('user-1');
    const data = ev.data as { state?: string };
    expect(['open', 'connecting']).toContain(data.state ?? '');
  });

  it('qrcode.updated: tem base64 e code', () => {
    const ev = buildSecondaryWebhookEvent('qrcode.updated', 'user-2', 6);
    const data = ev.data as { qrcode?: { base64?: string; code?: string } };
    expect(data.qrcode?.base64).toBeTruthy();
    expect(data.qrcode?.code ?? '').toContain('LOAD-QR-');
  });

  it('groups.upsert: id e subject', () => {
    const ev = buildSecondaryWebhookEvent('groups.upsert', 'user-3', 7);
    const data = ev.data as { id?: string; subject?: string };
    expect(data.id ?? '').toContain('@g.us');
    expect(data.subject ?? '').toContain('Group');
  });

  it('group-participants.update: participants array', () => {
    const ev = buildSecondaryWebhookEvent('group-participants.update', 'user-4', 8);
    const data = ev.data as { participants?: unknown[]; action?: string };
    expect(Array.isArray(data.participants)).toBe(true);
    expect(data.action).toBe('add');
  });
});

describe('buildAffiliateProfileUpdate', () => {
  it('retorna affiliateStatus + messageTemplate', () => {
    const b = buildAffiliateProfileUpdate(1);
    expect(['active', 'paused']).toContain((b.affiliateStatus as string | undefined) ?? '');
    expect(String(b.messageTemplate as string)).toContain('{link_convertido}');
  });
});

describe('buildTestConversionPayload', () => {
  it('shopee -> URL com -i.SHOPID.ITEMID', () => {
    expect(String(buildTestConversionPayload('shopee').url)).toContain('shopee.com.br');
  });
  it('magalu -> URL magazineluiza', () => {
    expect(String(buildTestConversionPayload('magalu').url)).toContain('magazineluiza');
  });
});

describe('buildMalformedWebhook', () => {
  it('data sem remoteJid valido (nao processa, mas retorna 200)', () => {
    const ev = buildMalformedWebhook(1);
    expect(ev.event).toBe('messages.upsert');
    const data = ev.data as { key?: { id?: string; remoteJid?: string } };
    expect(data.key?.id ?? '').toContain('BAD');
    expect(data.key?.remoteJid).toBeUndefined();
  });
});

describe('buildIgnoredWebhook', () => {
  it('remoteJid de grupo nao monitorado', () => {
    const ev = buildIgnoredWebhook(1);
    const data = ev.data as { key?: { remoteJid?: string } };
    expect(data.key?.remoteJid).toContain('@g.us');
    expect(data.key?.remoteJid).not.toContain('120363'); // nao e source
  });
});
