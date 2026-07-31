/**
 * Testes da orquestração do backfill (backfill.ts) com dependências fake —
 * nenhuma conexão real a PostgreSQL/Redis (padrão do projeto).
 */
import { describe, expect, it } from 'bun:test';
import type { PublishCatalogJobParams } from '@omestre/worker-common';
import { runBackfill, summarizeBackfill } from './backfill.ts';
import type { BackfillDeps, ReflectedOfferBackfillRow } from './backfill.ts';

function row(overrides: Partial<ReflectedOfferBackfillRow>): ReflectedOfferBackfillRow {
  return {
    id: 1,
    affiliateId: 1,
    sourceGroupJid: '1203630000@g.us',
    originalLink: 'https://shopee.com.br/Capinha-i.123.456',
    marketplace: 'shopee',
    reflectedAt: new Date('2026-07-30T12:00:00.000Z'),
    ...overrides,
  };
}

function makeDeps(rowsByPage: ReflectedOfferBackfillRow[][]): {
  deps: BackfillDeps;
  published: PublishCatalogJobParams[];
} {
  const published: PublishCatalogJobParams[] = [];
  let pageIndex = 0;
  const deps: BackfillDeps = {
    listReflectedOffers: async () => {
      const page = rowsByPage[pageIndex] ?? [];
      pageIndex += 1;
      return page;
    },
    listAffiliateInstanceNames: async () =>
      new Map([
        [1, 'user-7'],
        [2, 'dispatch-x'],
      ]),
    publish: async (params) => {
      published.push(params);
      return true;
    },
  };
  return { deps, published };
}

describe('runBackfill', () => {
  it('sem reflected_offers → stats zerados, publish nunca chamado', async () => {
    const { deps, published } = makeDeps([[]]);
    const stats = await runBackfill(deps, { limit: 0, dryRun: false });
    expect(stats).toMatchObject({ scanned: 0, candidates: 0, published: 0, failed: 0 });
    expect(published).toHaveLength(0);
  });

  it('publica só linhas normalizáveis (magalu/unknown puladas)', async () => {
    const { deps, published } = makeDeps([
      [
        row({ id: 1, marketplace: 'shopee' }),
        row({
          id: 2,
          marketplace: 'magalu',
          originalLink: 'https://www.magazineluiza.com.br/x/p/abc',
        }),
        row({
          id: 3,
          marketplace: 'mercadolivre',
          originalLink: 'https://www.mercadolivre.com.br/MLB12345678901',
          affiliateId: 2,
        }),
        row({ id: 4, marketplace: 'unknown', originalLink: 'https://example.com/x' }),
      ],
      [],
    ]);
    const stats = await runBackfill(deps, { limit: 0, dryRun: false });

    expect(stats.scanned).toBe(4);
    expect(stats.candidates).toBe(2);
    expect(stats.published).toBe(2);
    expect(stats.failed).toBe(0);
    expect(published).toHaveLength(2);
    expect(published[0]).toMatchObject({ messageId: 'backfill:1', userId: 7 });
    expect(published[1]).toMatchObject({ messageId: 'backfill:3', userId: null });
  });

  it('dry-run conta candidates sem publicar', async () => {
    const { deps, published } = makeDeps([[row({ id: 1 })], []]);
    const stats = await runBackfill(deps, { limit: 0, dryRun: true });

    expect(stats.dryRun).toBe(true);
    expect(stats.scanned).toBe(1);
    expect(stats.candidates).toBe(1);
    expect(stats.published).toBe(0);
    expect(published).toHaveLength(0);
  });

  it('paginador keyset avança entre lotes até página vazia', async () => {
    const calls: number[] = [];
    const { deps } = makeDeps([
      [row({ id: 1 }), row({ id: 2 })],
      [row({ id: 3 }), row({ id: 4 })],
      [],
    ]);
    deps.listReflectedOffers = async (afterId: number) => {
      calls.push(afterId);
      const pages: Record<number, ReflectedOfferBackfillRow[]> = {
        0: [row({ id: 1 }), row({ id: 2 })],
        2: [row({ id: 3 }), row({ id: 4 })],
        4: [],
      };
      return pages[afterId] ?? [];
    };

    const stats = await runBackfill(deps, { limit: 0, dryRun: false });
    expect(calls).toEqual([0, 2, 4]);
    expect(stats.scanned).toBe(4);
    expect(stats.published).toBe(4);
  });

  it('--limit N para no teto (não busca mais páginas)', async () => {
    const { deps } = makeDeps([
      [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })],
      [row({ id: 4 })],
      [],
    ]);
    let nextPageFetched = false;
    deps.listReflectedOffers = async (afterId: number) => {
      if (afterId > 0) nextPageFetched = true;
      const pages: Record<number, ReflectedOfferBackfillRow[]> = {
        0: [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })],
        3: [row({ id: 4 })],
      };
      return pages[afterId] ?? [];
    };

    const stats = await runBackfill(deps, { limit: 2, dryRun: false });
    expect(stats.scanned).toBe(2);
    expect(stats.candidates).toBe(2);
    expect(stats.published).toBe(2);
    expect(nextPageFetched).toBe(false);
  });

  it('falha de publish conta em failed e não aborta o restante', async () => {
    const deps: BackfillDeps = {
      // fake com fim: retorna as 3 linhas só na primeira página, senão vazio
      listReflectedOffers: async (afterId: number) =>
        afterId === 0 ? [row({ id: 1 }), row({ id: 2 }), row({ id: 3 })] : [],
      listAffiliateInstanceNames: async () => new Map([[1, 'user-7']]),
      publish: async (params) => {
        if (params.messageId === 'backfill:2') throw new Error('redis down');
        return params.messageId !== 'backfill:3'; // false = não publicou
      },
    };

    const stats = await runBackfill(deps, { limit: 0, dryRun: false });
    expect(stats.scanned).toBe(3);
    expect(stats.candidates).toBe(3);
    expect(stats.published).toBe(1);
    expect(stats.failed).toBe(2);
  });
});

describe('summarizeBackfill', () => {
  it('reporta números e modo', () => {
    const text = summarizeBackfill({
      scanned: 10,
      candidates: 8,
      published: 7,
      failed: 1,
      dryRun: false,
      durationMs: 1234,
    });
    expect(text).toContain('Linhas varridas: 10');
    expect(text).toContain('Normalizáveis:   8');
    expect(text).toContain('7 publicado(s) na Queue C');
    expect(text).toContain('Duração:         1234ms');
  });

  it('dry-run aparece no modo', () => {
    const text = summarizeBackfill({
      scanned: 5,
      candidates: 4,
      published: 0,
      failed: 0,
      dryRun: true,
      durationMs: 10,
    });
    expect(text).toContain('dry-run (nada foi publicado)');
  });
});
