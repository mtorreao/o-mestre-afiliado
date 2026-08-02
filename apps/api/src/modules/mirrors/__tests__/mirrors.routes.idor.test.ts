/**
 * Testes de IDOR (Insecure Direct Object Reference) — Item #2 da análise.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const { createJwtPlugin: realCreateJwtPlugin } = await import('../../../middleware/auth.ts');

type MirrorRecord = {
  id: number;
  userId: number;
  name: string;
  status: string;
  sourceGroups: { jid: string; name: string }[];
  targetGroups: { jid: string; name: string }[];
  messageTemplate: string | null;
};

let store = new Map<number, MirrorRecord>();

const listMock = mock(() =>
  Promise.resolve({
    rows: [...store.values()],
    total: store.size,
    page: 1,
    pageSize: 25,
    totalPages: 1,
  }),
);

const findByIdMock = mock((id: number) => Promise.resolve(store.get(id) ?? null));

const createMock = mock((input: { userId?: number; name?: string } = {}) => {
  const id = 100 + store.size;
  const record: MirrorRecord = {
    id,
    userId: input.userId ?? 1,
    name: input.name ?? 'novo',
    status: 'active',
    sourceGroups: [],
    targetGroups: [],
    messageTemplate: null,
  };
  store.set(id, record);
  return Promise.resolve(record);
});

const updateMock = mock((id: number, data: Record<string, unknown>) => {
  const current = store.get(id);
  if (!current) return Promise.resolve(null);
  const updated = { ...current, ...data } as MirrorRecord;
  store.set(id, updated);
  return Promise.resolve(updated);
});

const patchStatusMock = mock((id: number, status: string) => {
  const current = store.get(id);
  if (!current) return Promise.resolve(null);
  const updated = { ...current, status } as MirrorRecord;
  store.set(id, updated);
  return Promise.resolve(updated);
});

const deleteMock = mock((id: number) => {
  const existed = store.has(id);
  store.delete(id);
  return Promise.resolve(existed);
});

// Mock completo do group-cache com TODAS as exports (evita SyntaxError
// quando outro teste paralelo exporta o módulo via mock.module)
await mock.module('../../../services/group-cache.ts', () => ({
  replaceSourceGroups: mock(() => Promise.resolve()),
  removeSourceGroups: mock(() => Promise.resolve()),
  replaceMirrorsBySourceGroups: mock(() => Promise.resolve()),
  removeMirrorsBySourceGroups: mock(() => Promise.resolve()),
  cacheSourceGroup: mock(() => Promise.resolve()),
  warmSourceGroupCache: mock(() => Promise.resolve()),
  getSourceGroupInfo: mock(() => Promise.resolve(null)),
  clearSourceGroupCache: mock(() => Promise.resolve()),
  removeSourceGroup: mock(() => Promise.resolve()),
  cacheSourceGroupConfigs: mock(() => Promise.resolve()),
  getSourceGroupConfigs: mock(() => Promise.resolve([])),
  getAffiliateIdBySourceGroup: mock(() => Promise.resolve(null)),
}));

let currentAuth: { userId: number; userEmail: string } | null = {
  userId: 1,
  userEmail: 'alice@x.com',
};

const getAuthUserMock = mock(async () => currentAuth);

await mock.module('@omestre/db', () => ({
  MirrorRepository: class {
    list = listMock;
    findById = findByIdMock;
    create = createMock;
    update = updateMock;
    patchStatus = patchStatusMock;
    delete = deleteMock;
  },
  AffiliatesRepository: class {},
}));

await mock.module('../../../middleware/auth.ts', () => ({
  createJwtPlugin: realCreateJwtPlugin,
  getAuthUser: getAuthUserMock,
}));

const { mirrorRoutes } = await import('../mirrors.routes.ts');
const app = new Elysia().use(mirrorRoutes);

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
  store = new Map<number, MirrorRecord>([
    [
      100,
      {
        id: 100,
        userId: 1,
        name: 'mirror-alice',
        status: 'active',
        sourceGroups: [],
        targetGroups: [],
        messageTemplate: null,
      },
    ],
    [
      200,
      {
        id: 200,
        userId: 2,
        name: 'mirror-bob',
        status: 'active',
        sourceGroups: [],
        targetGroups: [],
        messageTemplate: null,
      },
    ],
  ]);
  for (const m of [
    listMock,
    findByIdMock,
    createMock,
    updateMock,
    patchStatusMock,
    deleteMock,
    getAuthUserMock,
  ]) {
    m.mockClear?.();
  }
  currentAuth = { userId: 1, userEmail: 'alice@x.com' };
});

describe('Item #2 — IDOR cross-tenant', () => {
  it('Alice NÃO pode ver espelhamento do Bob (GET)', async () => {
    const res = await call('GET', '/api/mirrors/200');
    expect(res.status).toBe(404);
  });

  it('Alice NÃO pode atualizar espelhamento do Bob (PUT)', async () => {
    const res = await call('PUT', '/api/mirrors/200', { body: { name: 'hack' } });
    expect(res.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('Alice NÃO pode alterar status do espelhamento do Bob (PATCH)', async () => {
    const res = await call('PATCH', '/api/mirrors/200/status', {
      body: { status: 'inactive' },
    });
    expect(res.status).toBe(404);
    expect(patchStatusMock).not.toHaveBeenCalled();
  });

  it('Alice NÃO pode deletar espelhamento do Bob (DELETE)', async () => {
    const res = await call('DELETE', '/api/mirrors/200');
    expect(res.status).toBe(404);
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('Alice PODE ver o próprio espelhamento', async () => {
    const res = await call('GET', '/api/mirrors/100');
    expect(res.status).toBe(200);
  });

  it('Alice PODE atualizar o próprio espelhamento', async () => {
    const res = await call('PUT', '/api/mirrors/100', { body: { name: 'novo' } });
    expect(res.status).toBe(200);
  });

  it('Alice PODE alterar status do próprio espelhamento', async () => {
    const res = await call('PATCH', '/api/mirrors/100/status', {
      body: { status: 'inactive' },
    });
    expect(res.status).toBe(200);
  });

  it('Alice PODE deletar o próprio espelhamento', async () => {
    const res = await call('DELETE', '/api/mirrors/100');
    expect(res.status).toBe(200);
  });

  it('Sem auth → 401 em GET /:id', async () => {
    currentAuth = null;
    const res = await call('GET', '/api/mirrors/200');
    expect(res.status).toBe(401);
  });

  it('Sem auth → 401 em PUT /:id', async () => {
    currentAuth = null;
    const res = await call('PUT', '/api/mirrors/200', { body: { name: 'x' } });
    expect(res.status).toBe(401);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('Sem auth → 401 em DELETE /:id', async () => {
    currentAuth = null;
    const res = await call('DELETE', '/api/mirrors/200');
    expect(res.status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
