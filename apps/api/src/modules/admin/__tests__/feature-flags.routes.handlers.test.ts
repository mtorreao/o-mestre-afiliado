/**
 * Testes de INTEGRAÇÃO dos handlers de feature-flags.routes.ts (rotas /api/admin/feature-flags).
 *
 * Foco: distinguir HTTP 401 (sem token / token inválido) de 200 (admin)
 * e 403 (autenticado, sem role admin). Mockamos I/O (repo DB + módulo
 * @omestre/feature-flags + middleware/auth) para exercitar as rotas de
 * verdade sem Redis/DB reais. A linha de base é o bug pre-existente:
 * o handler retornava HTTP 200 com `{ success:false, error:'Não autorizado' }`
 * mesmo sem token, mascarando ausência de auth no status code.
 *
 * NOTA sobre mock.module('@omestre/db'): o mock de módulo do bun é global
 * ao processo (todos os *.test.ts do subprojeto rodam no mesmo processo),
 * então este mock faz snapshot do módulo real (const realDb) e espalha os
 * símbolos que OUTROS testes usam (marketplaceEnum, CatalogRepository,
 * MirrorRepository/AffiliatesRepository — mesmo padrão de
 * catalog.routes.handlers.test.ts / mirrors.routes.handlers.test.ts) para
 * não quebrar mirrors.routes.test.ts / catalog.routes.handlers.test.ts.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const { createJwtPlugin: realCreateJwtPlugin } = await import('../../../middleware/auth.ts');

// ─── Mocks de I/O ────────────────────────────────────────────────────

const findAllMock = mock(() =>
  Promise.resolve([
    { key: 'maintenance_mode', enabled: false, updatedBy: null, updatedAt: new Date() },
  ]),
);
const upsertMock = mock((_key: string, _enabled: boolean, _updatedBy: string | null) =>
  Promise.resolve({
    key: 'maintenance_mode',
    enabled: true,
    updatedBy: 'admin@x.com',
    updatedAt: new Date(),
  }),
);

const countFlagChecksMock = mock(() => Promise.resolve(0));

// Snapshot do módulo REAL antes de mockar: preserva todos os símbolos que
// OUTROS testes do mesmo processo importam de @omestre/db (marketplaceEnum
// do catalog.routes.handlers.test.ts, MirrorRepository/AffiliatesRepository
// do mirrors.routes.test.ts, etc.) — mesmo padrão de
// catalog.routes.handlers.test.ts / mirrors.routes.handlers.test.ts.
const realDb = await import('@omestre/db');
await mock.module('@omestre/db', () => ({
  ...realDb,
  // Símbolos que este teste usa.
  FeatureFlagRepository: class {
    findAll = findAllMock;
    upsert = upsertMock;
  },
}));

await mock.module('@omestre/feature-flags', () => ({
  FLAGS: {
    maintenance_mode: {
      label: 'Manutenção',
      description: 'Bloqueia API',
      category: 'Operacional',
      defaultEnabled: false,
      danger: true,
    },
  },
  ALL_FLAG_KEYS: ['maintenance_mode'],
  countFlagChecks: countFlagChecksMock,
  invalidateFlagCache: () => {},
  publishFlagInvalidation: () => {},
}));

const getAuthUserMock = mock(async (_jwt: unknown, _headers: unknown) => ({
  userId: 1,
  userEmail: 'admin@x.com',
  isAdmin: true,
}));

await mock.module('../../../middleware/auth.ts', () => ({
  createJwtPlugin: realCreateJwtPlugin,
  getAuthUser: getAuthUserMock,
}));

const { featureFlagsRoutes } = await import('../feature-flags.routes.ts');

const app = new Elysia().use(featureFlagsRoutes);

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
  findAllMock.mockClear();
  upsertMock.mockClear();
  countFlagChecksMock.mockClear();
  getAuthUserMock.mockClear();
});

describe('GET /api/admin/feature-flags', () => {
  it('sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/admin/feature-flags');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
  });

  it('token sem Bearer prefix → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/admin/feature-flags', {
      headers: { authorization: 'Basic abc' },
    });
    expect(res.status).toBe(401);
  });

  it('token inválido (verify=null) → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/admin/feature-flags', {
      headers: { authorization: 'Bearer xxx' },
    });
    expect(res.status).toBe(401);
  });

  it('token autenticado mas sem role admin → 403', async () => {
    getAuthUserMock.mockImplementation(async () => ({
      userId: 2,
      userEmail: 'user@x.com',
      isAdmin: false,
    }));
    const res = await call('GET', '/api/admin/feature-flags');
    expect(res.status).toBe(403);
  });

  it('token admin → 200 com lista de flags', async () => {
    getAuthUserMock.mockImplementation(async () => ({
      userId: 1,
      userEmail: 'admin@x.com',
      isAdmin: true,
    }));
    const res = await call('GET', '/api/admin/feature-flags');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; flags: unknown[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.flags)).toBe(true);
  });
});

describe('PATCH /api/admin/feature-flags/:key', () => {
  it('sem token → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('PATCH', '/api/admin/feature-flags/maintenance_mode', {
      body: { enabled: true },
    });
    expect(res.status).toBe(401);
  });

  it('token não-admin → 403', async () => {
    getAuthUserMock.mockImplementation(async () => ({
      userId: 2,
      userEmail: 'user@x.com',
      isAdmin: false,
    }));
    const res = await call('PATCH', '/api/admin/feature-flags/maintenance_mode', {
      body: { enabled: true },
    });
    expect(res.status).toBe(403);
  });

  it('token admin + chave válida → 200', async () => {
    getAuthUserMock.mockImplementation(async () => ({
      userId: 1,
      userEmail: 'admin@x.com',
      isAdmin: true,
    }));
    const res = await call('PATCH', '/api/admin/feature-flags/maintenance_mode', {
      body: { enabled: true },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; flag: { key: string } };
    expect(body.success).toBe(true);
    expect(body.flag.key).toBe('maintenance_mode');
  });
});
