/**
 * Testes do processCatalogJob — orquestração do CatalogWorker.
 *
 * O fetcher é mockado (sem rede) e o repositório é um fake que captura
 * as chamadas de upsert. Cobrem os 3 desfechos: sucesso (ACK), descarte
 * sem dado útil (ACK) e erro de infra (lança → DLQ no caller).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CatalogJob } from '@omestre/shared';
import type { CatalogRepository } from '@omestre/db';
import type { CatalogFetchResult } from '@omestre/db';

const baseJob: CatalogJob = {
  id: 'job-1',
  productKey: 'mercadolivre:MLB12345678',
  marketplace: 'mercadolivre',
  itemId: 'MLB12345678',
  resolvedUrl: 'https://produto.mercadolivre.com.br/MLB-12345678-x',
  sourceGroupJid: '1203630001@g.us',
  messageId: 'msg-1',
  capturedAt: '2026-07-31T14:32:00.000Z',
  userId: null,
};

function makeFakeRepo(
  over: Partial<{
    upsertCatalog: (
      r: CatalogFetchResult,
    ) => Promise<{ productId: number; variationIds: number[]; insertedHistory: number }>;
  }> = {},
): CatalogRepository {
  return {
    upsertCatalog:
      over.upsertCatalog ?? (async () => ({ productId: 1, variationIds: [1], insertedHistory: 1 })),
  } as unknown as CatalogRepository;
}

let mockedFetch: (input: unknown) => Promise<unknown>;

// Mock do fetcher ANTES de importar o catalog-worker
await mock.module('./catalog-fetcher.ts', () => ({
  fetchCatalogData: (input: unknown) => mockedFetch(input),
}));

const { processCatalogJob } = await import('./catalog-worker.ts');

describe('processCatalogJob', () => {
  beforeEach(() => {
    mockedFetch = async () => ({ kind: 'none', reason: 'default' });
  });

  it('ML com item grava catálogo e retorna true (ACK)', async () => {
    const repo = makeFakeRepo();
    mockedFetch = async () => ({
      kind: 'ml',
      item: {
        id: 'MLB12345678',
        title: 'Tenis',
        pictures: [{ secure_url: 'https://img/1.jpg' }],
        variations: [{ id: 101, price: 199.9, original_price: 249.9, available_quantity: 5 }],
      },
    });

    const ok = await processCatalogJob(baseJob, { repo, credentialsRepo: null });
    expect(ok).toBe(true);
  });

  it('sem dado util (unsupported) → descarta e retorna true (ACK)', async () => {
    const repo = makeFakeRepo();
    mockedFetch = async () => ({ kind: 'none', reason: 'unsupported_marketplace:amazon' });

    const ok = await processCatalogJob(
      { ...baseJob, marketplace: 'amazon', productKey: 'amazon:B0X', itemId: 'B0X' },
      { repo, credentialsRepo: null },
    );
    expect(ok).toBe(true);
  });
});

describe('processCatalogJob — desfechos de erro', () => {
  beforeEach(() => {
    mockedFetch = async () => ({ kind: 'none', reason: 'default' });
  });

  it('Shopee sem price util → descarta (ACK, sem erro)', async () => {
    const repo = makeFakeRepo();
    mockedFetch = async () => ({
      kind: 'shopee',
      offer: { productName: 'Mouse', price: null },
    });

    const ok = await processCatalogJob(
      { ...baseJob, marketplace: 'shopee', productKey: 'shopee:1', itemId: '1', userId: 5 },
      { repo, credentialsRepo: null },
    );
    expect(ok).toBe(true);
  });

  it('falha no fetch (ml_fetch_failed) → descarta, nao lança', async () => {
    const repo = makeFakeRepo();
    mockedFetch = async () => ({ kind: 'none', reason: 'ml_fetch_failed' });

    const ok = await processCatalogJob(baseJob, { repo, credentialsRepo: null });
    expect(ok).toBe(true);
  });

  it('erro no repositório propaga (caller decide DLQ)', async () => {
    const repo = makeFakeRepo({
      upsertCatalog: async () => {
        throw new Error('db connection refused');
      },
    });
    mockedFetch = async () => ({
      kind: 'ml',
      item: { id: 'MLB12345678', title: 'Tenis', price: 99.9 },
    });

    await expect(processCatalogJob(baseJob, { repo, credentialsRepo: null })).rejects.toThrow(
      'db connection refused',
    );
  });

  it('shopee com offer valido grava via repo', async () => {
    let captured: CatalogFetchResult | null = null;
    const repo = makeFakeRepo({
      upsertCatalog: async (r) => {
        captured = r;
        return { productId: 7, variationIds: [7], insertedHistory: 1 };
      },
    });
    mockedFetch = async () => ({
      kind: 'shopee',
      offer: { productName: 'Mouse', imageUrl: 'https://img/1.jpg', price: 89.9 },
    });

    const ok = await processCatalogJob(
      {
        ...baseJob,
        marketplace: 'shopee',
        productKey: 'shopee:22298230083',
        itemId: '22298230083',
        userId: 5,
      },
      { repo, credentialsRepo: null },
    );
    expect(ok).toBe(true);
    expect(captured).not.toBeNull();
    expect(captured!.product.productKey).toBe('shopee:22298230083');
    expect(captured!.variations).toHaveLength(1);
    expect(captured!.variations[0]?.row.variationKey).toBe('shopee:22298230083:default');
  });
});
