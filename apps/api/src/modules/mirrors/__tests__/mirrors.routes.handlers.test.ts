/**
 * Testes de INTEGRAÇÃO dos handlers de mirrors.routes.ts.
 *
 * Mockamos as dependências de I/O (repo DB, auth, group-cache Redis,
 * evolution) para exercitar as rotas de verdade (parse de query, validação
 * de id, validação de status, construção de input, envelopes) sem DB/Redis
 * reais. O objetivo é subir a cobertura de linhas de mirrors.routes.ts além
 * da camada pura.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const { createJwtPlugin: realCreateJwtPlugin } = await import('../../../middleware/auth.ts');

// ─── Mocks de I/O ────────────────────────────────────────────────────

const listMock = mock((filters?: { page?: number; pageSize?: number }) =>
  Promise.resolve({
    rows: [{ id: 1, name: 'm1' }],
    total: 1,
    page: filters?.page ?? 1,
    pageSize: filters?.pageSize ?? 25,
    totalPages: 1,
  }),
);
const findByIdMock = mock((id: number) =>
  Promise.resolve(
    id === 999 ? null : { id, name: 'm', sourceGroups: [{ jid: 'g@g.us', name: 'G' }], userId: 1 },
  ),
);
const createMock = mock((input: unknown) =>
  Promise.resolve({ id: 7, sourceGroups: [], ...(input as object) }),
);
const updateMock = mock((id: number, _data: unknown) =>
  Promise.resolve(
    id === 404 ? null : { id, name: 'updated', sourceGroups: [{ jid: 'g@g.us', name: 'G' }] },
  ),
);
const patchStatusMock = mock((id: number, status: string) =>
  Promise.resolve(id === 404 ? null : { id, status, sourceGroups: [{ jid: 'g@g.us', name: 'G' }] }),
);
const deleteMock = mock((id: number) => Promise.resolve(id !== 404));

const replaceSourceGroupsMock = mock(() => Promise.resolve());
const removeSourceGroupsMock = mock(() => Promise.resolve());
const findByEvolutionInstanceIdMock = mock((_instance: string) => Promise.resolve({ id: 5 }));
const instanceNameFromUserIdMock = mock((userId: number) => `user-${userId}`);

const getAuthUserMock = mock(async (_jwt: unknown, _headers: unknown) => ({
  userId: 1,
  userEmail: 'u@x.com',
}));

await mock.module('@omestre/db', () => ({
  MirrorRepository: class {
    list = listMock;
    findById = findByIdMock;
    create = createMock;
    update = updateMock;
    patchStatus = patchStatusMock;
    delete = deleteMock;
  },
  AffiliatesRepository: class {
    findByEvolutionInstanceId = findByEvolutionInstanceIdMock;
  },
}));

await mock.module('../../../middleware/auth.ts', () => ({
  createJwtPlugin: realCreateJwtPlugin,
  getAuthUser: getAuthUserMock,
}));

await mock.module('../../../services/group-cache.ts', () => ({
  replaceSourceGroups: replaceSourceGroupsMock,
  removeSourceGroups: removeSourceGroupsMock,
}));

await mock.module('../../../services/evolution.ts', () => ({
  instanceNameFromUserId: instanceNameFromUserIdMock,
}));

const { mirrorRoutes } = await import('../mirrors.routes.ts');

const app = new Elysia().use(mirrorRoutes);

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
    listMock,
    findByIdMock,
    createMock,
    updateMock,
    patchStatusMock,
    deleteMock,
    replaceSourceGroupsMock,
    removeSourceGroupsMock,
    findByEvolutionInstanceIdMock,
    instanceNameFromUserIdMock,
    getAuthUserMock,
  ]) {
    m.mockClear?.();
  }
  getAuthUserMock.mockImplementation(async () => ({ userId: 1, userEmail: 'u@x.com' }));
});

describe('GET /api/mirrors (lista)', () => {
  it('parseia query e retorna lista', async () => {
    const res = await call('GET', '/api/mirrors', {
      query: { page: '2', pageSize: '10', status: 'active', search: 'promo' },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.page).toBe(2);
    expect(listMock).toHaveBeenCalled();
  });

  it('não autenticado → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('GET', '/api/mirrors');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/mirrors/:id (detalhe)', () => {
  it('id válido → 200', async () => {
    const res = await call('GET', '/api/mirrors/5');
    expect(res.status).toBe(200);
    expect((await res.json()).mirror.id).toBe(5);
  });

  it('id inválido → 400', async () => {
    const res = await call('GET', '/api/mirrors/abc');
    expect(res.status).toBe(400);
  });

  it('não encontrado → 404', async () => {
    const res = await call('GET', '/api/mirrors/999');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/mirrors (criar)', () => {
  it('cria com sourceGroups e popula cache', async () => {
    const res = await call('POST', '/api/mirrors', {
      body: { name: 'Novo', sourceGroups: [{ jid: 's@g.us', name: 'O' }] },
    });
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalled();
    expect(replaceSourceGroupsMock).toHaveBeenCalled();
  });

  it('cria sem sourceGroups (não popula cache)', async () => {
    const res = await call('POST', '/api/mirrors', { body: { name: 'Sem' } });
    expect(res.status).toBe(200);
    expect(replaceSourceGroupsMock).not.toHaveBeenCalled();
  });

  it('não autenticado → 401', async () => {
    getAuthUserMock.mockImplementation(async () => null as never);
    const res = await call('POST', '/api/mirrors', { body: { name: 'x' } });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/mirrors/:id (atualizar)', () => {
  it('atualiza e recompõe cache quando sourceGroups mudam', async () => {
    const res = await call('PUT', '/api/mirrors/1', {
      body: { name: 'Novo', sourceGroups: [{ jid: 's2@g.us', name: 'O2' }] },
    });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    expect(replaceSourceGroupsMock).toHaveBeenCalled();
  });

  it('não toca cache quando sourceGroups ausentes', async () => {
    const res = await call('PUT', '/api/mirrors/1', { body: { name: 'Só nome' } });
    expect(res.status).toBe(200);
    expect(replaceSourceGroupsMock).not.toHaveBeenCalled();
  });

  it('id inválido → 400', async () => {
    const res = await call('PUT', '/api/mirrors/xyz', { body: { name: 'x' } });
    expect(res.status).toBe(400);
  });

  it('não encontrado → 404', async () => {
    const res = await call('PUT', '/api/mirrors/404', { body: { name: 'x' } });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/mirrors/:id/status', () => {
  it('status inválido → 400', async () => {
    const res = await call('PATCH', '/api/mirrors/1/status', { body: { status: 'paused' } });
    expect(res.status).toBe(400);
  });

  it('inactive → remove do cache', async () => {
    const res = await call('PATCH', '/api/mirrors/1/status', { body: { status: 'inactive' } });
    expect(res.status).toBe(200);
    expect(removeSourceGroupsMock).toHaveBeenCalled();
  });

  it('active → repopula cache', async () => {
    const res = await call('PATCH', '/api/mirrors/1/status', { body: { status: 'active' } });
    expect(res.status).toBe(200);
    expect(replaceSourceGroupsMock).toHaveBeenCalled();
  });

  it('id inválido → 400', async () => {
    const res = await call('PATCH', '/api/mirrors/abc/status', { body: { status: 'active' } });
    expect(res.status).toBe(400);
  });

  it('não encontrado → 404', async () => {
    const res = await call('PATCH', '/api/mirrors/404/status', { body: { status: 'active' } });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/mirrors/:id', () => {
  it('exclui e remove cache', async () => {
    const res = await call('DELETE', '/api/mirrors/1');
    expect(res.status).toBe(200);
    expect(deleteMock).toHaveBeenCalled();
    expect(removeSourceGroupsMock).toHaveBeenCalled();
  });

  it('id inválido → 400', async () => {
    const res = await call('DELETE', '/api/mirrors/xyz');
    expect(res.status).toBe(400);
  });

  it('não encontrado (findById) → 404', async () => {
    const res = await call('DELETE', '/api/mirrors/999');
    expect(res.status).toBe(404);
  });

  it('não encontrado (delete) → 404', async () => {
    const res = await call('DELETE', '/api/mirrors/404');
    expect(res.status).toBe(404);
  });
});
