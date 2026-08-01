/**
 * Testes de INTEGRAÇÃO dos handlers de magalu.routes.ts.
 *
 * Mockamos as dependências de I/O (repo DB, auth, converter) para exercitar
 * as rotas de verdade (validação de slug, envelopes, status codes) sem
 * PostgreSQL/Redis/rede reais.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const { createJwtPlugin: realCreateJwtPlugin } = await import('../../middleware/auth.ts');
const realConverters = await import('@omestre/converters');
// Módulo real espalhado no mock: mantém MirrorRepository e demais exports
// intactos para os outros arquivos de teste que rodam no mesmo processo.
const realDb = await import('@omestre/db');

// ─── Mocks de I/O ────────────────────────────────────────────────────

const findByUserIdMock = mock((userId: number) =>
  Promise.resolve(
    userId === 999
      ? null
      : {
          id: 1,
          userId,
          nickname: 'Matheus - Magalu',
          storeSlug: 'magazinetorre',
          active: true,
          connectedAt: new Date('2026-07-01T00:00:00Z'),
          lastUsedAt: new Date('2026-07-01T00:00:00Z'),
        },
  ),
);
const upsertMock = mock((userId: number, data: unknown) =>
  Promise.resolve({
    id: 1,
    userId,
    nickname: (data as { nickname?: string }).nickname ?? null,
    storeSlug: (data as { storeSlug: string }).storeSlug,
    active: (data as { active?: boolean }).active ?? true,
  }),
);
const deleteMock = mock((userId: number) => Promise.resolve(userId !== 999));
const touchMock = mock(() => Promise.resolve());
const convertMock = mock((url: string, _storeSlug: string | null | undefined) =>
  Promise.resolve({
    success: true,
    originalUrl: url,
    affiliateUrl: 'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/in/te/',
    marketplace: 'magalu',
    method: 'fallback',
  }),
);

const getAuthUserMock = mock(async (_jwt: unknown, _headers: unknown) => ({
  userId: 1,
  userEmail: 'u@x.com',
  isAdmin: false,
}));

await mock.module('@omestre/db', () => ({
  ...realDb,
  MagaluAffiliateRepository: class {
    findByUserId = findByUserIdMock;
    upsert = upsertMock;
    delete = deleteMock;
    touch = touchMock;
  },
}));

await mock.module('../../middleware/auth.ts', () => ({
  createJwtPlugin: realCreateJwtPlugin,
  getAuthUser: getAuthUserMock,
}));

await mock.module('@omestre/converters', () => ({
  ...realConverters,
  convertMagaluUrlWithStoreSlug: convertMock,
}));

const { magaluRoutes } = await import('./magalu.routes.ts');

const app = new Elysia().use(magaluRoutes);

async function call(
  method: string,
  path: string,
  opts: { query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
) {
  const url = new URL(`http://localhost${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
  }
  return app.handle(
    new Request(url.toString(), {
      method,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

beforeEach(() => {
  for (const m of [
    findByUserIdMock,
    upsertMock,
    deleteMock,
    touchMock,
    convertMock,
    getAuthUserMock,
  ]) {
    m.mockClear?.();
  }
  // Restaura implementações default (mockImplementation vaza entre testes)
  findByUserIdMock.mockImplementation((userId: number) =>
    Promise.resolve(
      userId === 999
        ? null
        : {
            id: 1,
            userId,
            nickname: 'Matheus - Magalu',
            storeSlug: 'magazinetorre',
            active: true,
            connectedAt: new Date('2026-07-01T00:00:00Z'),
            lastUsedAt: new Date('2026-07-01T00:00:00Z'),
          },
    ),
  );
  deleteMock.mockImplementation((userId: number) => Promise.resolve(userId !== 999));
  convertMock.mockImplementation((url: string, _storeSlug: string | null | undefined) =>
    Promise.resolve({
      success: true,
      originalUrl: url,
      affiliateUrl: 'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/in/te/',
      marketplace: 'magalu',
      method: 'fallback',
    }),
  );
  getAuthUserMock.mockImplementation(async () => ({
    userId: 1,
    userEmail: 'u@x.com',
    isAdmin: false,
  }));
});

// ─── GET /api/magalu/affiliate ────────────────────────────────────────

describe('GET /api/magalu/affiliate', () => {
  it('sem config → { configured: false }', async () => {
    findByUserIdMock.mockImplementation(async () => null);
    const res = await call('GET', '/api/magalu/affiliate');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.configured).toBe(false);
    expect(json.affiliate).toBeNull();
  });

  it('com config → retorna storeSlug', async () => {
    const res = await call('GET', '/api/magalu/affiliate');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.configured).toBe(true);
    expect(json.affiliate.storeSlug).toBe('magazinetorre');
    expect(json.affiliate.active).toBe(true);
  });

  it('não autenticado → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/magalu/affiliate');
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
  });
});

// ─── PUT /api/magalu/affiliate ────────────────────────────────────────

describe('PUT /api/magalu/affiliate', () => {
  it('slug válido → 200 com affiliate', async () => {
    const res = await call('PUT', '/api/magalu/affiliate', {
      body: { nickname: 'Matheus - Magalu', storeSlug: 'magazinetorre' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.affiliate.storeSlug).toBe('magazinetorre');
    expect(upsertMock).toHaveBeenCalled();
  });

  it('slug inválido (curto demais) → 400 com mensagem clara', async () => {
    const res = await call('PUT', '/api/magalu/affiliate', {
      body: { storeSlug: 'A' },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Slug da loja inválido');
    expect(json.error).toContain('3-40');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('slug inválido (caracteres proibidos) → 400', async () => {
    const res = await call('PUT', '/api/magalu/affiliate', {
      body: { storeSlug: 'Magazine Torre' },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Slug da loja inválido');
  });

  it('sem slug e sem afiliado existente → 400 (slug obrigatório)', async () => {
    findByUserIdMock.mockImplementation(async () => null);
    const res = await call('PUT', '/api/magalu/affiliate', {
      body: { nickname: 'Só nickname' },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('slug é obrigatório');
  });

  it('sem slug mas com afiliado existente → mantém slug atual', async () => {
    const res = await call('PUT', '/api/magalu/affiliate', {
      body: { nickname: 'Novo apelido' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.affiliate.storeSlug).toBe('magazinetorre');
  });
});

// ─── DELETE /api/magalu/affiliate ─────────────────────────────────────

describe('DELETE /api/magalu/affiliate', () => {
  it('afiliado existe → 200', async () => {
    const res = await call('DELETE', '/api/magalu/affiliate');
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(deleteMock).toHaveBeenCalled();
  });

  it('afiliado não existe → 404', async () => {
    deleteMock.mockImplementation(async () => false);
    const res = await call('DELETE', '/api/magalu/affiliate');
    expect(res.status).toBe(404);
    expect((await res.json()).success).toBe(false);
  });
});

// ─── GET /api/magalu/affiliate/validate-slug ──────────────────────────

describe('GET /api/magalu/affiliate/validate-slug', () => {
  it('slug válido → 200 com exists (HEAD ok)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    ) as unknown as typeof fetch;
    try {
      const res = await call('GET', '/api/magalu/affiliate/validate-slug', {
        query: { slug: 'magazinetorre' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.exists).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('slug válido com falha de rede → exists: null (sem validação)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('network down')),
    ) as unknown as typeof fetch;
    try {
      const res = await call('GET', '/api/magalu/affiliate/validate-slug', {
        query: { slug: 'magazinetorre' },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.exists).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('slug inválido → 400', async () => {
    const res = await call('GET', '/api/magalu/affiliate/validate-slug', {
      query: { slug: 'x' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
  });
});

// ─── POST /api/magalu/convert ─────────────────────────────────────────

describe('POST /api/magalu/convert', () => {
  it('URL Magalu + afiliado configurado → 200 com affiliateUrl', async () => {
    const res = await call('POST', '/api/magalu/convert', {
      body: { url: 'https://www.magazineluiza.com.br/celular-x/p/12345/' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.affiliateUrl).toContain('magazinevoce.com.br/magazinetorre/');
    expect(json.marketplace).toBe('magalu');
    expect(convertMock).toHaveBeenCalledWith(
      'https://www.magazineluiza.com.br/celular-x/p/12345/',
      'magazinetorre',
    );
    expect(touchMock).toHaveBeenCalled();
  });

  it('sem URL → 400', async () => {
    const res = await call('POST', '/api/magalu/convert', { body: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('URL é obrigatória');
  });

  it('URL não-Magalu → 400', async () => {
    const res = await call('POST', '/api/magalu/convert', {
      body: { url: 'https://www.amazon.com.br/dp/B0ABC123' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('URL não é da Magalu');
  });

  it('sem afiliado configurado → 404 com erro descritivo', async () => {
    findByUserIdMock.mockImplementation(async () => null);
    const res = await call('POST', '/api/magalu/convert', {
      body: { url: 'https://www.magazineluiza.com.br/celular-x/p/12345/' },
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error).toContain('Afiliado Magalu não configurado');
    expect(convertMock).not.toHaveBeenCalled();
  });

  it('afiliado inativo → 404', async () => {
    findByUserIdMock.mockImplementation(
      async () =>
        ({
          id: 1,
          userId: 1,
          nickname: null,
          storeSlug: 'magazinetorre',
          active: false,
          connectedAt: new Date('2026-07-01T00:00:00Z'),
          lastUsedAt: new Date('2026-07-01T00:00:00Z'),
        }) as never,
    );
    const res = await call('POST', '/api/magalu/convert', {
      body: { url: 'https://www.magazineluiza.com.br/celular-x/p/12345/' },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('Afiliado Magalu não configurado');
  });
});
