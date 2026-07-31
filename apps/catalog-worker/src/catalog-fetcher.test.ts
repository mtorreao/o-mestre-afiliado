/**
 * Testes do catalog-fetcher — busca de dado fresco por marketplace.
 *
 * Nenhuma rede real: `fetcher` é injetado (fetchMlItem/fetchCatalogData)
 * e `getProductOffer` do @omestre/converters é mockado via mock.module.
 */
import { describe, expect, it, mock } from 'bun:test';
import type { CatalogJob } from '@omestre/shared';

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

// Mock do converters ANTES de importar o fetcher
await mock.module('@omestre/converters', () => ({
  getProductOffer: async () => null,
}));

const { fetchCatalogData, fetchMlItem, fetchShopeeOffer, resolveShopeeCredentials } =
  await import('./catalog-fetcher.ts');

function fakeFetchOk(body: unknown): typeof fetch {
  const fn = async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }) as unknown as Response;
  return fn as unknown as typeof fetch;
}

function fakeFetchFail(): typeof fetch {
  const fn = async () => new Response('not found', { status: 404 }) as unknown as Response;
  return fn as unknown as typeof fetch;
}

describe('fetchMlItem', () => {
  it('parseia o item quando a API responde 200', async () => {
    const item = await fetchMlItem('MLB12345678', fakeFetchOk({ id: 'MLB12345678', title: 'X' }));
    expect(item?.title).toBe('X');
  });

  it('retorna null em HTTP nao-200', async () => {
    const item = await fetchMlItem('MLB12345678', fakeFetchFail());
    expect(item).toBeNull();
  });

  it('retorna null em erro de rede/timeout', async () => {
    const throwing = async () => {
      throw new Error('network down');
    };
    const item = await fetchMlItem('MLB12345678', throwing as unknown as typeof fetch);
    expect(item).toBeNull();
  });
});

describe('resolveShopeeCredentials', () => {
  it('retorna null com userId null', async () => {
    expect(await resolveShopeeCredentials(null, { findByUserId: async () => null })).toBeNull();
  });

  it('retorna null sem repo de credenciais', async () => {
    expect(await resolveShopeeCredentials(5, null)).toBeNull();
  });

  it('retorna null quando a linha nao tem shopeeAppId/Secret', async () => {
    const repo = { findByUserId: async () => ({ shopeeAppId: null, shopeeAppSecret: null }) };
    expect(await resolveShopeeCredentials(5, repo as never)).toBeNull();
  });

  it('retorna as creds quando presentes', async () => {
    const repo = { findByUserId: async () => ({ shopeeAppId: 'app', shopeeAppSecret: 'sec' }) };
    expect(await resolveShopeeCredentials(5, repo as never)).toEqual({
      appId: 'app',
      secret: 'sec',
    });
  });

  it('retorna null quando o repo lanca', async () => {
    const repo = {
      findByUserId: async () => {
        throw new Error('db down');
      },
    };
    expect(await resolveShopeeCredentials(5, repo as never)).toBeNull();
  });
});

describe('fetchShopeeOffer', () => {
  it('retorna o offer quando getProductOffer resolve', async () => {
    mock.module('@omestre/converters', () => ({
      getProductOffer: async () => ({ itemId: 22298230083, productName: 'Mouse', price: 89.9 }),
    }));
    const { fetchShopeeOffer } = await import('./catalog-fetcher.ts');
    const offer = await fetchShopeeOffer('https://shopee.com.br/-i.1.2', {
      appId: 'a',
      secret: 's',
    });
    expect(offer?.productName).toBe('Mouse');
  });

  it('retorna null quando getProductOffer retorna null', async () => {
    mock.module('@omestre/converters', () => ({
      getProductOffer: async () => null,
    }));
    const { fetchShopeeOffer } = await import('./catalog-fetcher.ts');
    expect(
      await fetchShopeeOffer('https://shopee.com.br/-i.1.2', { appId: 'a', secret: 's' }),
    ).toBeNull();
  });

  it('retorna null quando getProductOffer lanca', async () => {
    mock.module('@omestre/converters', () => ({
      getProductOffer: async () => {
        throw new Error('api down');
      },
    }));
    const { fetchShopeeOffer } = await import('./catalog-fetcher.ts');
    expect(
      await fetchShopeeOffer('https://shopee.com.br/-i.1.2', { appId: 'a', secret: 's' }),
    ).toBeNull();
  });
});

describe('fetchCatalogData — roteamento por marketplace', () => {
  it('mercadolivre com item → kind ml', async () => {
    const result = await fetchCatalogData(
      { job: baseJob, credentialsRepo: null },
      fakeFetchOk({ id: 'MLB12345678', title: 'Produto' }),
    );
    expect(result.kind).toBe('ml');
    if (result.kind === 'ml') expect(result.item.title).toBe('Produto');
  });

  it('mercadolivre com fetch falho → none ml_fetch_failed', async () => {
    const result = await fetchCatalogData({ job: baseJob, credentialsRepo: null }, fakeFetchFail());
    expect(result).toEqual({ kind: 'none', reason: 'ml_fetch_failed' });
  });

  it('shopee sem creds → none shopee_no_credentials', async () => {
    const shopeeJob: CatalogJob = {
      ...baseJob,
      marketplace: 'shopee',
      productKey: 'shopee:1',
      itemId: '1',
      userId: 5,
    };
    const result = await fetchCatalogData({ job: shopeeJob, credentialsRepo: null });
    expect(result).toEqual({ kind: 'none', reason: 'shopee_no_credentials' });
  });

  it('shopee com creds + offer → kind shopee', async () => {
    const shopeeJob: CatalogJob = {
      ...baseJob,
      marketplace: 'shopee',
      productKey: 'shopee:1',
      itemId: '1',
      userId: 5,
    };
    mock.module('@omestre/converters', () => ({
      getProductOffer: async () => ({ itemId: 1, productName: 'Mouse', price: 89.9 }),
    }));
    const { fetchCatalogData } = await import('./catalog-fetcher.ts');
    const credentialsRepo = {
      findByUserId: async () => ({ shopeeAppId: 'app', shopeeAppSecret: 'sec' }),
    };
    const result = await fetchCatalogData({
      job: shopeeJob,
      credentialsRepo: credentialsRepo as never,
    });
    expect(result.kind).toBe('shopee');
  });

  it('shopee com offer nulo → none shopee_fetch_failed', async () => {
    const shopeeJob: CatalogJob = {
      ...baseJob,
      marketplace: 'shopee',
      productKey: 'shopee:1',
      itemId: '1',
      userId: 5,
    };
    mock.module('@omestre/converters', () => ({
      getProductOffer: async () => null,
    }));
    const { fetchCatalogData } = await import('./catalog-fetcher.ts');
    const credentialsRepo = {
      findByUserId: async () => ({ shopeeAppId: 'app', shopeeAppSecret: 'sec' }),
    };
    const result = await fetchCatalogData({
      job: shopeeJob,
      credentialsRepo: credentialsRepo as never,
    });
    expect(result).toEqual({ kind: 'none', reason: 'shopee_fetch_failed' });
  });

  it('amazon/outros → none unsupported_marketplace', async () => {
    const amazonJob: CatalogJob = {
      ...baseJob,
      marketplace: 'amazon',
      productKey: 'amazon:B0X',
      itemId: 'B0X',
    };
    const result = await fetchCatalogData({ job: amazonJob, credentialsRepo: null });
    expect(result).toEqual({ kind: 'none', reason: 'unsupported_marketplace:amazon' });
  });
});
