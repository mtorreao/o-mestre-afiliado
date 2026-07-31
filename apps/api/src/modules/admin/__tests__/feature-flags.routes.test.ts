/**
 * Testes de INTEGRAÇÃO das rotas admin de feature flags
 * (apps/api/src/modules/admin/feature-flags.routes.ts).
 *
 * Reproduz o bug reportado: PATCH /api/admin/feature-flags/:key com
 * `enabled` como string ("true") retornava HTTP 500 ("Erro interno do
 * servidor") porque o onError global rebaixava o erro de validação
 * (code === 'VALIDATION') para 500 — violando a regra do projeto de
 * nunca devolver 5xx para erro de cliente.
 *
 * A rota é montada via factory `createFeatureFlagsRoutes()` com
 * dependências fake (repo, auth, registry) — sem mock.module, para não
 * colidir com o mock global de '@omestre/db' dos testes de mirrors.
 * O onError global usado é o MESMO de produção (error-handler.ts).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';
import { globalErrorHandler } from '../../../error-handler.ts';
import { createFeatureFlagsRoutes } from '../feature-flags.routes.ts';

// ─── Fakes de dependências ───────────────────────────────────────────

const findAllMock = mock(() => Promise.resolve([]));
const upsertMock = mock((_key: string, enabled: boolean, _by: string) =>
  Promise.resolve({
    key: 'maintenance_mode',
    enabled,
    updatedBy: 'admin@x.com',
    updatedAt: new Date('2026-07-31T12:00:00Z'),
  }),
);
const countFlagChecksMock = mock(() => Promise.resolve(0));
const invalidateFlagCacheMock = mock(() => undefined);
const publishFlagInvalidationMock = mock(() => undefined);

const getAdminMock = mock(async () => ({
  userId: 1,
  userEmail: 'admin@x.com',
  isAdmin: true,
}));

const FAKE_FLAGS = {
  maintenance_mode: {
    key: 'maintenance_mode',
    label: 'Modo Manutenção',
    description: 'Bloqueia acesso de usuários comuns à plataforma.',
    defaultEnabled: false,
    danger: true,
    category: 'Sistema',
  },
  evolution_send_enabled: {
    key: 'evolution_send_enabled',
    label: 'Envio Evolution',
    description: 'Quando desativado, o Dispatcher para de enviar mensagens.',
    defaultEnabled: true,
    danger: false,
    category: 'Envio',
  },
};

const app = new Elysia().onError(globalErrorHandler as never).use(
  createFeatureFlagsRoutes({
    flagRepo: { findAll: findAllMock, upsert: upsertMock },
    getAdmin: getAdminMock as never,
    flags: FAKE_FLAGS,
    allFlagKeys: ['maintenance_mode', 'evolution_send_enabled'],
    countFlagChecks: countFlagChecksMock,
    invalidateFlagCache: invalidateFlagCacheMock,
    publishFlagInvalidation: publishFlagInvalidationMock,
  }),
);

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
    findAllMock,
    upsertMock,
    countFlagChecksMock,
    invalidateFlagCacheMock,
    publishFlagInvalidationMock,
    getAdminMock,
  ]) {
    m.mockClear?.();
  }
  getAdminMock.mockImplementation(async () => ({
    userId: 1,
    userEmail: 'admin@x.com',
    isAdmin: true,
  }));
});

describe('PATCH /api/admin/feature-flags/:key (validar body)', () => {
  it('enabled como string ("true") → 400 com success:false (nunca 500)', async () => {
    const res = await call('PATCH', '/api/admin/feature-flags/maintenance_mode', {
      body: { enabled: 'true' },
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(String(json.error)).toContain('enabled');
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('body sem enabled ({}) → 400 com success:false (nunca 500)', async () => {
    const res = await call('PATCH', '/api/admin/feature-flags/maintenance_mode', {
      body: {},
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it('enabled como boolean true → 200 success:true e persiste', async () => {
    const res = await call('PATCH', '/api/admin/feature-flags/maintenance_mode', {
      body: { enabled: true },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.flag.enabled).toBe(true);
    expect(upsertMock).toHaveBeenCalledWith('maintenance_mode', true, 'admin@x.com');
    expect(invalidateFlagCacheMock).toHaveBeenCalledWith('maintenance_mode');
    expect(publishFlagInvalidationMock).toHaveBeenCalledWith('maintenance_mode');
  });

  it('enabled como boolean false → 200 success:true', async () => {
    const res = await call('PATCH', '/api/admin/feature-flags/evolution_send_enabled', {
      body: { enabled: false },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.flag.enabled).toBe(false);
  });

  it('flag desconhecida → 200 com success:false e mensagem', async () => {
    const res = await call('PATCH', '/api/admin/feature-flags/flux_capacitor', {
      body: { enabled: true },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(String(json.error)).toContain('flux_capacitor');
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/feature-flags (regressão)', () => {
  it('lista flags com valores padrão quando não há linhas no banco', async () => {
    const res = await call('GET', '/api/admin/feature-flags');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.flags).toHaveLength(2);
    expect(json.flags[0].key).toBe('maintenance_mode');
    expect(json.flags[0].enabled).toBe(false);
    expect(json.flags[1].key).toBe('evolution_send_enabled');
    expect(json.flags[1].enabled).toBe(true);
    expect(findAllMock).toHaveBeenCalled();
  });
});
