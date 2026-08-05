/**
 * Testes de integração das rotas de feature-flags no admin-api (Hono).
 *
 * Usa `app.request()` do Hono (sem servidor real) e injeta deps para
 * evitar DB/Redis reais. Os casos cobrem o espectro:
 *   - GET sem sessão → 401
 *   - GET com sessão + repo vazio → defaults
 *   - GET com sessão + flag presente → enabled correto
 *   - GET com erro de DB → 200 success:false
 *   - PATCH com chave inválida → 200 success:false
 *   - PATCH com chave válida → upsert + invalidate + publish
 */

import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { createFeatureFlagsRoutes } from './feature-flags.ts';
import { createSession, isValidSession } from '../auth.ts';

function makeApp(deps: Parameters<typeof createFeatureFlagsRoutes>[0] = {}) {
  // Cada teste obtém uma app nova para isolar o middleware de sessão.
  const app = createFeatureFlagsRoutes(deps);
  return app;
}

function call(
  app: ReturnType<typeof makeApp>,
  method: string,
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

async function authedHeaders() {
  const token = createSession();
  return { Authorization: `Bearer ${token}` };
}

const BASE_FLAGS = {
  maintenance_mode: {
    key: 'maintenance_mode',
    label: 'Modo Manutenção',
    description: 'Bloqueia API',
    category: 'Sistema',
    defaultEnabled: false,
    danger: true,
  },
  evolution_send_enabled: {
    key: 'evolution_send_enabled',
    label: 'Envio Evolution',
    description: 'Liga envio',
    category: 'Envio',
    defaultEnabled: true,
    danger: false,
  },
};

const BASE_KEYS = ['maintenance_mode', 'evolution_send_enabled'];

describe('GET /api/admin/feature-flags', () => {
  it('sem Bearer → 401', async () => {
    const app = makeApp();
    const res = await call(app, 'GET', '/feature-flags');
    expect(res.status).toBe(401);
  });

  it('Bearer inválido → 401', async () => {
    const app = makeApp();
    const res = await call(app, 'GET', '/feature-flags', {
      headers: { Authorization: 'Bearer token-invalido' },
    });
    expect(res.status).toBe(401);
  });

  it('com Bearer + repo vazio → defaults das flags', async () => {
    const findAll = mock(() => Promise.resolve([]));
    const app = makeApp({
      flags: BASE_FLAGS,
      allFlagKeys: BASE_KEYS,
      flagRepo: { findAll, upsert: mock(() => Promise.resolve(undefined as never)) },
      countFlagChecks: mock(() => Promise.resolve(0)),
      publishFlagInvalidation: () => true,
      getFlagRedis: mock(() => null),
    });
    const res = await call(app, 'GET', '/feature-flags', { headers: await authedHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      flags: Array<{ key: string; enabled: boolean }>;
    };
    expect(body.success).toBe(true);
    expect(body.flags).toHaveLength(2);
    const map = new Map(body.flags.map((f) => [f.key, f.enabled]));
    expect(map.get('maintenance_mode')).toBe(false); // defaultEnabled false
    expect(map.get('evolution_send_enabled')).toBe(true); // defaultEnabled true
  });

  it('com Bearer + flag existente → enabled correto', async () => {
    const enabledDate = new Date('2026-08-04T12:00:00Z');
    const findAll = mock(() =>
      Promise.resolve([
        {
          key: 'maintenance_mode',
          enabled: true,
          updatedBy: 'admin@x.com',
          updatedAt: enabledDate,
        },
      ]),
    );
    const app = makeApp({
      flags: BASE_FLAGS,
      allFlagKeys: BASE_KEYS,
      flagRepo: { findAll, upsert: mock(() => Promise.resolve(undefined as never)) },
      countFlagChecks: mock(() => Promise.resolve(7)),
      publishFlagInvalidation: () => true,
      getFlagRedis: mock(() => null),
    });
    const res = await call(app, 'GET', '/feature-flags', { headers: await authedHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      flags: Array<{
        key: string;
        enabled: boolean;
        updatedBy: string | null;
        checksLastHour: number;
      }>;
    };
    expect(body.success).toBe(true);
    const mm = body.flags.find((f) => f.key === 'maintenance_mode')!;
    expect(mm.enabled).toBe(true);
    expect(mm.updatedBy).toBe('admin@x.com');
    expect(mm.checksLastHour).toBe(7);
  });

  it('com Bearer + erro de DB → 200 success:false', async () => {
    const findAll = mock(() => Promise.reject(new Error('connection lost')));
    const app = makeApp({
      flags: BASE_FLAGS,
      allFlagKeys: BASE_KEYS,
      flagRepo: { findAll, upsert: mock(() => Promise.resolve(undefined as never)) },
      countFlagChecks: mock(() => Promise.resolve(0)),
      publishFlagInvalidation: () => true,
      getFlagRedis: mock(() => null),
    });
    const res = await call(app, 'GET', '/feature-flags', { headers: await authedHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Erro interno');
  });
});

describe('PATCH /api/admin/feature-flags/:key', () => {
  it('sem Bearer → 401', async () => {
    const app = makeApp();
    const res = await call(app, 'PATCH', '/feature-flags/maintenance_mode', {
      body: { enabled: true },
    });
    expect(res.status).toBe(401);
  });

  it('com Bearer + key inválida → 200 success:false', async () => {
    const app = makeApp({
      flags: BASE_FLAGS,
      allFlagKeys: BASE_KEYS,
      flagRepo: {
        findAll: mock(() => Promise.resolve([])),
        upsert: mock(() => Promise.resolve(undefined as never)),
      },
      countFlagChecks: mock(() => Promise.resolve(0)),
      publishFlagInvalidation: () => true,
      getFlagRedis: mock(() => null),
    });
    const res = await call(app, 'PATCH', '/feature-flags/flag-que-nao-existe', {
      headers: await authedHeaders(),
      body: { enabled: true },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('Flag desconhecida');
  });

  it('com Bearer + body inválido (não-boolean) → 200 success:false', async () => {
    const app = makeApp({
      flags: BASE_FLAGS,
      allFlagKeys: BASE_KEYS,
      flagRepo: {
        findAll: mock(() => Promise.resolve([])),
        upsert: mock(() => Promise.resolve(undefined as never)),
      },
      countFlagChecks: mock(() => Promise.resolve(0)),
      publishFlagInvalidation: () => true,
      getFlagRedis: mock(() => null),
    });
    const res = await call(app, 'PATCH', '/feature-flags/maintenance_mode', {
      headers: await authedHeaders(),
      body: { enabled: 'yes' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('boolean');
  });

  it('com Bearer + key válida → upsert + publish + retorna flag', async () => {
    const publishMock = mock(() => true);
    const upsertMock = mock(() =>
      Promise.resolve({
        key: 'maintenance_mode',
        enabled: true,
        updatedBy: 'admin',
        updatedAt: new Date('2026-08-04T12:00:00Z'),
      }),
    );
    const app = makeApp({
      flags: BASE_FLAGS,
      allFlagKeys: BASE_KEYS,
      flagRepo: {
        findAll: mock(() => Promise.resolve([])),
        upsert: upsertMock,
      },
      countFlagChecks: mock(() => Promise.resolve(0)),
      publishFlagInvalidation: publishMock,
      getFlagRedis: mock(() => null),
    });
    const res = await call(app, 'PATCH', '/feature-flags/maintenance_mode', {
      headers: await authedHeaders(),
      body: { enabled: true },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      flag?: { key: string; enabled: boolean };
    };
    expect(body.success).toBe(true);
    expect(body.flag?.key).toBe('maintenance_mode');
    expect(body.flag?.enabled).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(publishMock).toHaveBeenCalledWith('maintenance_mode');
  });
});

// Sanity check do helper createSession para garantir que o middleware está OK.
describe('infra: auth session', () => {
  it('token criado é válido', () => {
    const token = createSession();
    expect(isValidSession(token)).toBe(true);
  });
});
