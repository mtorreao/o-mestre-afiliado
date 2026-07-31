/**
 * Testes de INTEGRAÇÃO dos handlers de catalog.routes.ts.
 *
 * Mockamos o CatalogRepository (@omestre/db) e o getAdminUser para exercitar
 * as rotas de verdade (parse de query/params, gate isAdmin -> 403, envelopes)
 * sem DB real. Mesmo padrão de mirrors.routes.handlers.test.ts.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const { createJwtPlugin: realCreateJwtPlugin } = await import('../../../middleware/auth.ts');

// ─── Mocks ───────────────────────────────────────────────────────────

const listProductsMock = mock((filters?: Record<string, unknown>) =>
  Promise.resolve({
    rows: [{ id: 1, title: 'Fone', marketplace: 'shopee' }],
    total: 1,
    page: filters?.page ?? 1,
    pageSize: filters?.pageSize ?? 25,
    totalPages: 1,
  }),
);

const getProductWithVariationsMock = mock((id: number) =>
  Promise.resolve(
    id === 999
      ? null
      : {
          product: { id, marketplace: 'shopee', title: 'Fone' },
          variations: [
            {
              id: 10,
              productId: id,
              variationKey: 'k',
              variationId: null,
              variationName: 'Preto',
              attributesJson: {},
              lastSeenAt: new Date(),
              history: [
                {
                  id: 100,
                  price: '99.90',
                  listPrice: '129.90',
                  currency: 'BRL',
                  available: true,
                  stock: 5,
                  capturedAt: new Date(),
                  source: 'background',
                },
              ],
            },
          ],
        },
  ),
);

const getVariationHistoryMock = mock((id: number, options?: Record<string, string>) => {
  if (id === 404) return Promise.resolve(null);
  return Promise.resolve([
    {
      id: 100,
      price: '99.90',
      listPrice: '129.90',
      currency: 'BRL',
      available: true,
      stock: 5,
      capturedAt: new Date('2026-01-01T00:00:00Z'),
      source: 'background',
    },
    {
      id: 101,
      price: '89.90',
      listPrice: null,
      currency: 'BRL',
      available: true,
      stock: 3,
      capturedAt: new Date('2026-01-02T00:00:00Z'),
      source: 'background',
    },
  ]);
});

const getAdminUserMock = mock(async () => ({
  userId: 1,
  userEmail: 'admin@x.com',
  isAdmin: true,
}));

// mock.module é process-wide no bun test: snapshot do módulo REAL antes de
// mockar preserva todos os símbolos que outros arquivos do mesmo processo
// importam de @omestre/db (ex: MirrorRepository, AffiliatesRepository).
const realDb = await import('@omestre/db');
await mock.module('@omestre/db', () => ({
  ...realDb,
  CatalogRepository: class {
    listProducts = listProductsMock;
    getProductWithVariations = getProductWithVariationsMock;
    getVariationHistory = getVariationHistoryMock;
  },
}));

await mock.module('../../../middleware/auth.ts', () => ({
  createJwtPlugin: realCreateJwtPlugin,
  getAdminUser: getAdminUserMock,
}));

const { catalogRoutes } = await import('../catalog.routes.ts');

const app = new Elysia().use(catalogRoutes);

async function call(
  method: string,
  path: string,
  opts: { query?: Record<string, string>; headers?: Record<string, string> } = {},
) {
  const url = new URL(`http://localhost${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  return app.handle(
    new Request(url.toString(), {
      method,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    }),
  );
}

beforeEach(() => {
  for (const m of [listProductsMock, getProductWithVariationsMock, getVariationHistoryMock]) {
    m.mockClear?.();
  }
  getAdminUserMock.mockImplementation(async () => ({
    userId: 1,
    userEmail: 'admin@x.com',
    isAdmin: true,
  }));
});

describe('GET /api/catalog/products (lista)', () => {
  it('sem token -> 403', async () => {
    getAdminUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/catalog/products');
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toBe('Não autorizado');
  });

  it('não-admin (getAdminUser retorna null) -> 403', async () => {
    // getAdminUser real retorna null quando o usuário não é admin
    getAdminUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/catalog/products');
    expect(res.status).toBe(403);
    expect((await res.json()).success).toBe(false);
    expect(getAdminUserMock).toHaveBeenCalled();
  });

  it('admin lista produtos com filtros e paginação', async () => {
    const res = await call('GET', '/api/catalog/products', {
      query: { marketplace: 'shopee', search: 'fone', page: '2', pageSize: '10' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.rows).toHaveLength(1);
    expect(json.page).toBe(2);
    expect(json.pageSize).toBe(10);
    expect(listProductsMock).toHaveBeenCalledWith({
      marketplace: 'shopee',
      search: 'fone',
      page: 2,
      pageSize: 10,
    });
  });

  it('marketplace inválido é ignorado (não quebra a query)', async () => {
    const res = await call('GET', '/api/catalog/products', {
      query: { marketplace: 'nao-existe' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(listProductsMock).toHaveBeenCalledWith({
      marketplace: undefined,
      search: undefined,
      page: undefined,
      pageSize: undefined,
    });
  });

  it('admin lista sem filtros (query vazia)', async () => {
    const res = await call('GET', '/api/catalog/products');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(listProductsMock).toHaveBeenCalledWith({
      marketplace: undefined,
      search: undefined,
      page: undefined,
      pageSize: undefined,
    });
  });
});

describe('GET /api/catalog/products/:id (detalhe)', () => {
  it('sem token -> 403', async () => {
    getAdminUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/catalog/products/1');
    expect(res.status).toBe(403);
    expect((await res.json()).success).toBe(false);
  });

  it('id inválido -> error', async () => {
    const res = await call('GET', '/api/catalog/products/abc');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('produto não encontrado -> error', async () => {
    const res = await call('GET', '/api/catalog/products/999');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('admin obtém detalhe com variações e histórico', async () => {
    const res = await call('GET', '/api/catalog/products/5');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.product.id).toBe(5);
    expect(json.variations).toHaveLength(1);
    expect(json.variations[0].history).toHaveLength(1);
  });
});

describe('GET /api/catalog/variations/:id/history', () => {
  it('sem token -> 403', async () => {
    getAdminUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/catalog/variations/10/history');
    expect(res.status).toBe(403);
    expect((await res.json()).success).toBe(false);
  });

  it('id inválido -> error', async () => {
    const res = await call('GET', '/api/catalog/variations/xyz/history');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('variação não encontrada -> error', async () => {
    const res = await call('GET', '/api/catalog/variations/404/history');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(false);
  });

  it('admin obtém pontos com filtro de período', async () => {
    const res = await call('GET', '/api/catalog/variations/10/history', {
      query: { from: '2026-01-01', to: '2026-01-31' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.points).toHaveLength(2);
    expect(json.points[0].price).toBe('99.90');
    expect(getVariationHistoryMock).toHaveBeenCalledWith(10, {
      from: '2026-01-01',
      to: '2026-01-31',
    });
  });

  it('admin obtém histórico sem filtros', async () => {
    const res = await call('GET', '/api/catalog/variations/10/history');
    expect(res.status).toBe(200);
    expect((await res.json()).points).toHaveLength(2);
    expect(getVariationHistoryMock).toHaveBeenCalledWith(10, {
      from: undefined,
      to: undefined,
    });
  });
});
