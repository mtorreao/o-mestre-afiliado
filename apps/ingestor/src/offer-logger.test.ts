/**
 * Testes da função PURA `buildReflectedOfferRow` em apps/ingestor/src/offer-logger.ts.
 *
 * Cobre 100% das regras de montagem da linha persistida sem precisar de
 * DB/Redis — a I/O (insert no Postgres) vive em `logReflectedOffer`.
 */
import { describe, expect, it } from 'bun:test';
import { buildReflectedOfferRow, type ReflectedOfferInput } from './offer-logger.ts';

function baseInput(overrides: Partial<ReflectedOfferInput> = {}): ReflectedOfferInput {
  return {
    affiliateId: 7,
    sourceGroupJid: 'source@group',
    targetGroupJid: 'target@group',
    originalLink: 'https://shopee.com.br/produto-i.1.2',
    convertedLink: 'https://shp.ee/abc',
    marketplace: 'shopee',
    messagePreview: 'confira essa oferta',
    status: 'sent',
    ...overrides,
  };
}

describe('buildReflectedOfferRow', () => {
  it('mantém campos simples inalterados', () => {
    const row = buildReflectedOfferRow(baseInput());
    expect(row.affiliateId).toBe(7);
    expect(row.sourceGroupJid).toBe('source@group');
    expect(row.targetGroupJid).toBe('target@group');
    expect(row.originalLink).toBe('https://shopee.com.br/produto-i.1.2');
    expect(row.convertedLink).toBe('https://shp.ee/abc');
    expect(row.marketplace).toBe('shopee');
    expect(row.status).toBe('sent');
  });

  it('usa convertedLink quando fornecido', () => {
    const row = buildReflectedOfferRow(baseInput({ convertedLink: 'https://s.shp.ee/x' }));
    expect(row.convertedLink).toBe('https://s.shp.ee/x');
  });

  it('cai para originalLink quando convertedLink é null', () => {
    const row = buildReflectedOfferRow(baseInput({ convertedLink: null }));
    expect(row.convertedLink).toBe('https://shopee.com.br/produto-i.1.2');
  });

  it('cai para originalLink quando convertedLink é undefined', () => {
    const { convertedLink: _omit, ...rest } = baseInput();
    const row = buildReflectedOfferRow(rest);
    expect(row.convertedLink).toBe('https://shopee.com.br/produto-i.1.2');
  });

  it('normaliza marketplace para o union do schema (cast, mesmo valor inesperado)', () => {
    const row = buildReflectedOfferRow(baseInput({ marketplace: 'magalu' as string }));
    // O schema só aceita shopee|mercadolivre|amazon|unknown; a função faz
    // cast direto, preservando o valor original recebido.
    expect(row.marketplace as string).toBe('magalu');
  });

  it('trunca messagePreview em 500 chars', () => {
    const longPreview = 'x'.repeat(1200);
    const row = buildReflectedOfferRow(baseInput({ messagePreview: longPreview }));
    expect(row.messagePreview.length).toBe(500);
    expect(row.messagePreview).toBe('x'.repeat(500));
  });

  it('mantém messagePreview íntegro quando ≤ 500 chars', () => {
    const preview = 'oferta top demais';
    const row = buildReflectedOfferRow(baseInput({ messagePreview: preview }));
    expect(row.messagePreview).toBe(preview);
  });

  it('define failureReason null quando ausente', () => {
    const row = buildReflectedOfferRow(baseInput({ status: 'sent' }));
    expect(row.failureReason).toBeNull();
  });

  it('define failureReason null quando undefined', () => {
    const { failureReason: _omit, ...rest } = baseInput({ failureReason: 'boom' });
    const row = buildReflectedOfferRow(rest);
    expect(row.failureReason).toBeNull();
  });

  it('mantém failureReason quando fornecido', () => {
    const row = buildReflectedOfferRow(baseInput({ status: 'failed', failureReason: 'DB down' }));
    expect(row.failureReason).toBe('DB down');
    expect(row.status).toBe('failed');
  });

  it('cobre status blocked (bloqueado pelo Link Builder)', () => {
    const row = buildReflectedOfferRow(
      baseInput({ status: 'blocked', failureReason: 'meli.la não é produto' }),
    );
    expect(row.status).toBe('blocked');
    expect(row.failureReason).toBe('meli.la não é produto');
  });
});
