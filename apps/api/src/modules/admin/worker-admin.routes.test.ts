import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';
import { createJwtPlugin } from '../../middleware/auth.ts';
import { createWorkerAdminRoutes } from './worker-admin.routes.ts';

const allowedAdmin = {
  userId: 21,
  userEmail: 'admin@omestreafiliado.com.br',
  isAdmin: true,
};

function makeApp(options: { authorized: boolean }) {
  return new Elysia().use(createJwtPlugin()).use(
    createWorkerAdminRoutes({
      getSuperAdmin: async () => (options.authorized ? allowedAdmin : null),
      getAggregatedWorkerStatus: async () => ({
        success: true,
        services: [],
        pipeline: { queueA: 0, queueB: 0 },
      }),
      listDlqItems: async () => ({ items: [], total: 0, totalFiltered: 0, offset: 0, limit: 20 }),
      requeueDlqItem: async () => ({ success: false }),
      removeDlqItem: async () => false,
      purgeDlq: async () => 0,
    }),
  );
}

function request(app: ReturnType<typeof makeApp>, method: string, path: string) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Authorization: 'Bearer test-token' },
    }),
  );
}

describe('worker admin routes', () => {
  const protectedRoutes = [
    ['GET', '/api/worker/status'],
    ['GET', '/api/worker/dlq'],
    ['POST', '/api/worker/dlq/requeue?id=test'],
    ['POST', '/api/worker/dlq/remove?id=test'],
    ['POST', '/api/worker/dlq/purge'],
  ] as const;

  for (const [method, path] of protectedRoutes) {
    it(`${method} ${path} rejeita quem não é super admin`, async () => {
      const res = await request(makeApp({ authorized: false }), method, path);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        success: false,
        error: 'Acesso restrito ao super admin',
      });
    });
  }

  it('permite que o super admin consulte o status', async () => {
    const res = await request(makeApp({ authorized: true }), 'GET', '/api/worker/status');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      services: [],
      pipeline: { queueA: 0, queueB: 0 },
    });
  });

  it('valida o ID apenas depois de autorizar o super admin', async () => {
    const res = await request(makeApp({ authorized: true }), 'POST', '/api/worker/dlq/requeue');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'ID é obrigatório' });
  });
});
