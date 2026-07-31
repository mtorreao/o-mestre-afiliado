/**
 * CatalogRepository -- testes unitários com mock.module('../db.ts').
 *
 * Cobre listProducts (paginação, filtros, agregados), getProductWithVariations
 * (detalhe + variações + preview de histórico) e getVariationHistory
 * (filtro de período, variação inexistente). Sem DB real.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';

// ─── Fábricas de dados ───────────────────────────────────────────────

function fakeProduct(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    marketplace: 'shopee',
    marketplaceItemId: '123',
    productKey: 'shopee:123',
    title: 'Fone Bluetooth',
    imageUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-01-02T00:00:00Z'),
    ...over,
  };
}

function fakeVariation(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 10,
    productId: 1,
    variationKey: 'shopee:123:v1',
    variationId: null,
    variationName: 'Preto',
    attributesJson: { cor: 'Preto' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-01-02T00:00:00Z'),
    ...over,
  };
}

function fakePricePoint(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100,
    variationId: 10,
    price: '99.90',
    listPrice: '129.90',
    currency: 'BRL',
    available: true,
    stock: 5,
    priceBucket: new Date('2026-01-01T00:00:00Z'),
    capturedAt: new Date('2026-01-01T00:00:00Z'),
    source: 'background',
    sourceGroupJid: null,
    messageId: null,
    ...over,
  };
}

// ─── Mock do db (por cenário) ────────────────────────────────────────

interface DbState {
  total?: unknown;
  agg?: unknown[];
  products?: unknown[];
  product?: unknown[];
  variations?: unknown[];
  history?: unknown[];
  variationExists?: unknown[];
  points?: unknown[];
}

function setDbState(state: DbState) {
  const db = {
    select: (cols?: unknown) => {
      // select({ total }) - count de products
      if (cols && typeof cols === 'object' && 'total' in cols) {
        return {
          from: () => ({
            where: () => Promise.resolve([state.total ?? { total: 0 }]),
          }),
        };
      }
      // select({ id }) - existencia de variacao
      if (cols && typeof cols === 'object' && 'id' in cols) {
        return {
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(state.variationExists ?? []) }),
          }),
        };
      }
      // select() - agregados (com leftJoin) ou linhas
      return {
        from: () => ({
          leftJoin: () => ({
            leftJoin: () => ({
              where: () => ({ groupBy: () => Promise.resolve(state.agg ?? []) }),
            }),
          }),
          where: () => ({
            limit: () => ({
              then: (resolve: (v: unknown) => void) => {
                resolve(state.product ?? state.variationExists ?? []);
              },
            }),
            orderBy: () => ({
              limit: () => ({
                then: (resolve: (v: unknown) => void) => {
                  resolve(state.history ?? state.products ?? []);
                },
                offset: () => Promise.resolve(state.products ?? []),
              }),
              then: (resolve: (v: unknown) => void) => {
                resolve(state.variations ?? state.points ?? []);
              },
            }),
          }),
        }),
      };
    },
  };
  mock.module('../db.ts', () => ({ getDb: () => db as never }));
}

afterEach(() => {
  mock.module('../db.ts', () => ({ getDb: () => ({}) as never }));
});

async function newRepo() {
  const { CatalogRepository } = await import('./catalog.repository.ts');
  return new CatalogRepository();
}

describe('CatalogRepository.listProducts', () => {
  it('retorna página vazia quando não há produtos', async () => {
    setDbState({ total: 0 });
    const repo = await newRepo();
    const res = await repo.listProducts();
    expect(res.rows).toEqual([]);
    expect(res.total).toBe(0);
    expect(res.totalPages).toBe(1);
  });

  it('lista produtos com agregados de variações e preços', async () => {
    setDbState({
      total: { total: 2 },
      agg: [
        {
          productId: 1,
          variationCount: 2,
          minPrice: '99.90',
          maxPrice: '129.90',
          lastCapturedAt: new Date('2026-01-03T00:00:00Z'),
        },
        {
          productId: 2,
          variationCount: 1,
          minPrice: '50.00',
          maxPrice: '50.00',
          lastCapturedAt: new Date('2026-01-04T00:00:00Z'),
        },
      ],
      products: [
        fakeProduct({ id: 1 }),
        fakeProduct({
          id: 2,
          marketplaceItemId: '456',
          productKey: 'shopee:456',
          title: 'Caixa de Som',
        }),
      ],
    });
    const repo = await newRepo();
    const res = await repo.listProducts({ page: 1, pageSize: 10 });
    expect(res.total).toBe(2);
    expect(res.totalPages).toBe(1);
    expect(res.rows).toHaveLength(2);
    expect(res.rows[0]).toMatchObject({
      id: 1,
      marketplace: 'shopee',
      title: 'Fone Bluetooth',
      variationCount: 2,
      minPrice: '99.90',
      maxPrice: '129.90',
    });
    expect(res.rows[0]!.lastCapturedAt).toEqual(new Date('2026-01-03T00:00:00Z'));
    expect(res.rows[1]!.title).toBe('Caixa de Som');
    expect(res.rows[1]!.variationCount).toBe(1);
  });

  it('aplica paginação com offset e totalPages', async () => {
    setDbState({
      total: { total: 25 },
      agg: [],
      products: [fakeProduct()],
    });
    const repo = await newRepo();
    const res = await repo.listProducts({ page: 2, pageSize: 10 });
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(10);
    expect(res.totalPages).toBe(3);
  });

  it('normaliza paginação fora dos limites', async () => {
    setDbState({ total: 0 });
    const repo = await newRepo();
    const res = await repo.listProducts({ page: 0, pageSize: 999 });
    expect(res.page).toBe(1);
    expect(res.pageSize).toBe(100);
  });
});

describe('CatalogRepository.getProductWithVariations', () => {
  it('retorna null quando produto não existe', async () => {
    setDbState({ product: [] });
    const repo = await newRepo();
    expect(await repo.getProductWithVariations(999)).toBeNull();
  });

  it('retorna detalhe com variações e preview de histórico', async () => {
    setDbState({
      product: [fakeProduct()],
      variations: [
        fakeVariation(),
        fakeVariation({
          id: 11,
          variationKey: 'shopee:123:v2',
          variationName: 'Azul',
          attributesJson: { cor: 'Azul' },
        }),
      ],
      history: [
        fakePricePoint(),
        fakePricePoint({
          id: 101,
          price: '89.90',
          listPrice: null,
          capturedAt: new Date('2026-01-02T00:00:00Z'),
        }),
      ],
    });
    const repo = await newRepo();
    const detail = await repo.getProductWithVariations(1);
    expect(detail).not.toBeNull();
    expect(detail!.product).toMatchObject({
      id: 1,
      marketplace: 'shopee',
      productKey: 'shopee:123',
    });
    expect(detail!.variations).toHaveLength(2);
    expect(detail!.variations[0]).toMatchObject({
      id: 10,
      productId: 1,
      variationKey: 'shopee:123:v1',
      variationName: 'Preto',
      attributesJson: { cor: 'Preto' },
    });
    expect(detail!.variations[0]!.history).toHaveLength(2);
    expect(detail!.variations[0]!.history[0]).toMatchObject({
      price: '99.90',
      listPrice: '129.90',
      currency: 'BRL',
      available: true,
      stock: 5,
      source: 'background',
    });
    expect(detail!.variations[0]!.history[1]!.listPrice).toBeNull();
  });

  it('variação sem histórico tem lista vazia', async () => {
    setDbState({
      product: [fakeProduct()],
      variations: [fakeVariation()],
      history: [],
    });
    const repo = await newRepo();
    const detail = await repo.getProductWithVariations(1);
    expect(detail!.variations[0]!.history).toEqual([]);
  });
});

describe('CatalogRepository.getVariationHistory', () => {
  it('retorna null quando variação não existe', async () => {
    setDbState({ variationExists: [] });
    const repo = await newRepo();
    expect(await repo.getVariationHistory(999)).toBeNull();
  });

  it('retorna pontos ordenados com filtro de período', async () => {
    setDbState({
      variationExists: [{ id: 10 }],
      points: [
        fakePricePoint(),
        fakePricePoint({
          id: 101,
          price: '89.90',
          listPrice: null,
          capturedAt: new Date('2026-01-02T00:00:00Z'),
        }),
      ],
    });
    const repo = await newRepo();
    const points = await repo.getVariationHistory(10, {
      from: '2026-01-01',
      to: '2026-01-31',
    });
    expect(points).toHaveLength(2);
    expect(points![0]!.price).toBe('99.90');
    expect(points![1]!.price).toBe('89.90');
    expect(points![1]!.listPrice).toBeNull();
  });
});
