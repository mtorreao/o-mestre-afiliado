/**
 * Testes de INTEGRAÇÃO dos handlers de ml.routes.ts — Item #1 da análise.
 *
 * Cobre os fluxos críticos de auth + ownership:
 *   - GET /api/ml/affiliates: 401 sem token, lista só do usuário
 *   - PUT /api/ml/affiliates/:mlUserId: 401 sem token, 403 se não for dono
 *   - DELETE /api/ml/affiliates/:mlUserId: 401 sem token, 403 se não for dono
 *   - POST /api/ml/affiliates/:mlUserId/validate-cookies: 401 sem token
 *   - POST /api/ml/convert: 401 sem token, 403 se affiliate não pertence ao user
 *   - POST /api/ml/refresh: 401 sem token
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const { createJwtPlugin: realCreateJwtPlugin } = await import('../../../middleware/auth.ts');

// ─── Mocks de repo ──────────────────────────────────────────────────────

type AffiliateRecord = {
  mlUserId: string;
  userId: number;
  nickname: string;
  meliid: string | null;
  melitat: string | null;
  sessionCookies: string | null;
};

const findByUserIdMock = mock((mlUserId: string) => {
  if (mlUserId === '123') {
    return Promise.resolve({
      mlUserId: '123',
      userId: 1,
      nickname: 'user1',
      meliid: 'om123',
      melitat: 'om123',
      sessionCookies: 'session=abc',
    } as AffiliateRecord);
  }
  if (mlUserId === '456') {
    return Promise.resolve({
      mlUserId: '456',
      userId: 2,
      nickname: 'user2',
      meliid: 'om456',
      melitat: 'om456',
      sessionCookies: null,
    } as AffiliateRecord);
  }
  return Promise.resolve(null);
});

const findByPlatformUserIdMock = mock((userId: number) => {
  if (userId === 1) {
    return Promise.resolve({
      mlUserId: '123',
      userId: 1,
      nickname: 'user1',
      meliid: 'om123',
      melitat: 'om123',
      sessionCookies: 'session=abc',
    } as AffiliateRecord);
  }
  return Promise.resolve(null);
});

const patchMock = mock((_mlUserId: string, data: Record<string, unknown>) =>
  Promise.resolve({
    mlUserId: '123',
    userId: 1,
    nickname: 'user1',
    meliid: 'om123',
    melitat: 'om123',
    sessionCookies: 'session=abc',
    ...data,
  } as AffiliateRecord | null),
);

const clearSessionCookiesMock = mock(() => Promise.resolve());

const touchMock = mock(() => Promise.resolve());

const upsertMock = mock(() => Promise.resolve({ mlUserId: '123' } as AffiliateRecord));

const getAuthUserMock = mock(async (_jwt: unknown, _headers: unknown) => ({
  userId: 1,
  userEmail: 'u@x.com',
}));

await mock.module('@omestre/db', () => ({
  MlAffiliateRepository: class {
    findByUserId = findByUserIdMock;
    findByPlatformUserId = findByPlatformUserIdMock;
    patch = patchMock;
    clearSessionCookies = clearSessionCookiesMock;
    touch = touchMock;
    upsert = upsertMock;
  },
  toMlSummaryPure: (a: AffiliateRecord) => ({
    mlUserId: a.mlUserId,
    nickname: a.nickname,
    meliid: a.meliid,
    melitat: a.melitat,
    hasSessionCookies: !!a.sessionCookies,
  }),
}));

await mock.module('../../../middleware/auth.ts', () => ({
  createJwtPlugin: realCreateJwtPlugin,
  getAuthUser: getAuthUserMock,
}));

await mock.module('../ml.service.ts', () => ({
  ML_CLIENT_ID: 'test_client_id',
  ML_CLIENT_SECRET: 'test_client_secret',
  REDIRECT_URI: 'http://localhost:5442/api/ml/callback',
  FRONTEND_URL: 'http://localhost:5441',
  mlRepo: {
    findByUserId: findByUserIdMock,
    findByPlatformUserId: findByPlatformUserIdMock,
    patch: patchMock,
    clearSessionCookies: clearSessionCookiesMock,
    touch: touchMock,
    upsert: upsertMock,
  },
  validateCookies: mock(() => Promise.resolve({ success: true, valid: true })),
}));

const { mlRoutes } = await import('../ml.routes.ts');

const app = new Elysia().use(mlRoutes);

async function call(
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

beforeEach(() => {
  for (const m of [
    findByUserIdMock,
    findByPlatformUserIdMock,
    patchMock,
    clearSessionCookiesMock,
    touchMock,
    upsertMock,
    getAuthUserMock,
  ]) {
    m.mockClear?.();
  }
  getAuthUserMock.mockImplementation(async () => ({ userId: 1, userEmail: 'u@x.com' }));
});

// ─── Item #1: rotas ML sem auth ────────────────────────────────────────

describe('Item #1 — Rotas ML exigem JWT', () => {
  it('GET /api/ml/affiliates sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/ml/affiliates');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('autenticado');
  });

  it('GET /api/ml/affiliates com token retorna só do usuário', async () => {
    const res = await call('GET', '/api/ml/affiliates');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; affiliates: unknown[] };
    expect(body.success).toBe(true);
    expect(body.affiliates).toHaveLength(1);
    expect(findByPlatformUserIdMock).toHaveBeenCalledWith(1);
  });

  it('PUT /api/ml/affiliates/:mlUserId sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('PUT', '/api/ml/affiliates/123', {
      body: { melitat: 'hack' },
    });
    expect(res.status).toBe(401);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('PUT afiliado alheio → 403 e NÃO chama patch', async () => {
    // user 1 tenta mexer no afiliado do user 2 (mlUserId=456)
    const res = await call('PUT', '/api/ml/affiliates/456', {
      body: { melitat: 'hack' },
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('PUT afiliado próprio → 200 e chama patch', async () => {
    const res = await call('PUT', '/api/ml/affiliates/123', {
      body: { melitat: 'new_tag' },
    });
    expect(res.status).toBe(200);
    expect(patchMock).toHaveBeenCalledWith('123', {
      meliid: undefined,
      melitat: 'new_tag',
      sessionCookies: undefined,
    });
  });

  it('DELETE /api/ml/affiliates/:mlUserId/cookies sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('DELETE', '/api/ml/affiliates/123/cookies');
    expect(res.status).toBe(401);
    expect(clearSessionCookiesMock).not.toHaveBeenCalled();
  });

  it('DELETE cookies de afiliado alheio → 403', async () => {
    const res = await call('DELETE', '/api/ml/affiliates/456/cookies');
    expect(res.status).toBe(403);
    expect(clearSessionCookiesMock).not.toHaveBeenCalled();
  });

  it('DELETE cookies próprio → 200 e chama clearSessionCookies', async () => {
    const res = await call('DELETE', '/api/ml/affiliates/123/cookies');
    expect(res.status).toBe(200);
    expect(clearSessionCookiesMock).toHaveBeenCalledWith('123');
  });

  it('POST /api/ml/affiliates/import-cookies sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('POST', '/api/ml/affiliates/import-cookies', {
      body: { sessionCookies: 'foo' },
    });
    expect(res.status).toBe(401);
  });

  it('POST /api/ml/convert sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('POST', '/api/ml/convert', {
      body: { url: 'https://produto.mercadolivre.com.br/MLB-1', mlUserId: '123' },
    });
    expect(res.status).toBe(401);
    expect(touchMock).not.toHaveBeenCalled();
  });

  it('POST /api/ml/convert com afiliado alheio → 403', async () => {
    const res = await call('POST', '/api/ml/convert', {
      body: { url: 'https://produto.mercadolivre.com.br/MLB-1', mlUserId: '456' },
    });
    expect(res.status).toBe(403);
    expect(touchMock).not.toHaveBeenCalled();
  });

  it('POST /api/ml/refresh sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('POST', '/api/ml/refresh', { body: { mlUserId: '123' } });
    expect(res.status).toBe(401);
  });

  it('POST /api/ml/refresh com afiliado alheio → 403', async () => {
    const res = await call('POST', '/api/ml/refresh', { body: { mlUserId: '456' } });
    expect(res.status).toBe(403);
  });
});

// ─── Rotas públicas (OAuth flow) — devem permanecer acessíveis ─────────

describe('Rotas OAuth do ML — mantidas públicas por design', () => {
  it('GET /api/ml/auth não exige token', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/ml/auth');
    // 302 redirect para auth.mercadolivre.com.br — não é 401
    expect([302, 200]).toContain(res.status);
  });
});
