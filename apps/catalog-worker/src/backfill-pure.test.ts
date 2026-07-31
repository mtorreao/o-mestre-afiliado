/**
 * Testes da lógica pura do backfill de catálogo (backfill-pure.ts).
 *
 * `planBackfillRow` decide se uma linha de reflected_offers vira um
 * CatalogJob (original_link normalizável) — e com qual userId/messageId/
 * capturedAt. `parseBackfillArgs` valida a CLI. Zero I/O.
 */
import { describe, expect, it } from 'bun:test';
import { BACKFILL_MESSAGE_PREFIX, parseBackfillArgs, planBackfillRow } from './backfill-pure.ts';

const base = {
  rowId: 42,
  sourceGroupJid: '1203630000@g.us',
  reflectedAt: new Date('2026-07-30T15:30:00.000Z'),
};

describe('planBackfillRow', () => {
  it('shopee normalizável → params prontos para publishCatalogJob', () => {
    const params = planBackfillRow({
      ...base,
      marketplace: 'shopee',
      originalLink: 'https://shopee.com.br/Capinha-i.123.456789012',
      instanceName: 'user-7',
    });
    expect(params).toEqual({
      marketplace: 'shopee',
      resolvedUrl: 'https://shopee.com.br/Capinha-i.123.456789012',
      sourceGroupJid: '1203630000@g.us',
      messageId: `${BACKFILL_MESSAGE_PREFIX}42`,
      capturedAt: '2026-07-30T15:30:00.000Z',
      userId: 7,
    });
  });

  it('mercadolivre normalizável com userId null (afiliado sem instance)', () => {
    const params = planBackfillRow({
      ...base,
      marketplace: 'mercadolivre',
      originalLink: 'https://www.mercadolivre.com.br/MLB12345678901',
      instanceName: null,
    });
    expect(params?.marketplace).toBe('mercadolivre');
    expect(params?.userId).toBeNull();
    expect(params?.messageId).toBe(`${BACKFILL_MESSAGE_PREFIX}42`);
  });

  it('amazon normalizável (ASIN /dp/)', () => {
    const params = planBackfillRow({
      ...base,
      marketplace: 'amazon',
      originalLink: 'https://www.amazon.com.br/dp/B07PXGQCK5',
      instanceName: 'user-3',
    });
    expect(params?.marketplace).toBe('amazon');
    expect(params?.userId).toBe(3);
    expect(params?.capturedAt).toBe('2026-07-30T15:30:00.000Z');
  });

  it('instanceName fora do padrão user-<id> → userId null', () => {
    const params = planBackfillRow({
      ...base,
      marketplace: 'shopee',
      originalLink: 'https://shopee.com.br/Capinha-i.123.456',
      instanceName: 'dispatch-x',
    });
    expect(params?.userId).toBeNull();
  });

  it('magalu → null (marketplace sem parser de itemId)', () => {
    expect(
      planBackfillRow({
        ...base,
        marketplace: 'magalu',
        originalLink: 'https://www.magazineluiza.com.br/x/p/abc',
        instanceName: null,
      }),
    ).toBeNull();
  });

  it('unknown → null', () => {
    expect(
      planBackfillRow({
        ...base,
        marketplace: 'unknown',
        originalLink: 'https://example.com/x',
        instanceName: null,
      }),
    ).toBeNull();
  });

  it('shopee sem itemId na URL → null (não normalizável)', () => {
    expect(
      planBackfillRow({
        ...base,
        marketplace: 'shopee',
        originalLink: 'https://shopee.com.br/shop/123456',
        instanceName: null,
      }),
    ).toBeNull();
  });
});

describe('parseBackfillArgs', () => {
  it('sem args → tudo (limit 0, sem dry-run)', () => {
    expect(parseBackfillArgs([])).toEqual({ limit: 0, dryRun: false });
  });

  it('--dry-run ativa modo seco', () => {
    expect(parseBackfillArgs(['--dry-run'])).toEqual({ limit: 0, dryRun: true });
  });

  it('--limit N define o teto de linhas', () => {
    expect(parseBackfillArgs(['--limit', '500'])).toEqual({ limit: 500, dryRun: false });
    expect(parseBackfillArgs(['--limit', '0'])).toEqual({ limit: 0, dryRun: false });
  });

  it('--limit sem valor → erro', () => {
    expect(() => parseBackfillArgs(['--limit'])).toThrow('--limit precisa de um inteiro >= 0');
  });

  it('--limit inválido → erro', () => {
    expect(() => parseBackfillArgs(['--limit', 'abc'])).toThrow(
      '--limit precisa de um inteiro >= 0',
    );
  });

  it('flag desconhecida → erro', () => {
    expect(() => parseBackfillArgs(['--bogus'])).toThrow('Flag desconhecida: --bogus');
  });

  it('combina flags', () => {
    expect(parseBackfillArgs(['--limit', '10', '--dry-run'])).toEqual({
      limit: 10,
      dryRun: true,
    });
  });
});
