/**
 * Testes de integração das rotas de worker status no admin-api (Hono).
 *
 * Cobre:
 *   - GET /status sem Bearer → 401
 *   - GET /status com Bearer + Redis/alvos offline → services reachable:false
 *   - GET /status com Bearer + Redis offline → queueA/queueB null
 *   - GET /dlq?offset=0 → lista
 *   - POST /dlq/requeue?id=X sem token → 401
 *   - POST /dlq/requeue?id=X → 200 success + targetStream
 *   - POST /dlq/remove?id=X → 200 success
 *   - POST /dlq/purge → 200 removed
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createWorkerRoutes } from './worker.ts';
import { createSession } from '../auth.ts';

function makeApp(deps: Parameters<typeof createWorkerRoutes>[0] = {}) {
  return createWorkerRoutes(deps);
}

async function authedHeaders() {
  const token = createSession();
  return { Authorization: `Bearer ${token}` };
}

function call(
  app: ReturnType<typeof makeApp>,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
) {
  const init: RequestInit = { method, headers: opts.headers ?? {} };
  if (opts.body !== undefined) {
    (init.headers as Record<string, string>)['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  return app.request(`http://localhost${path}`, init);
}

describe('GET /api/admin/worker/status', () => {
  it('sem Bearer → 401', async () => {
    const app = makeApp();
    const res = await call(app, 'GET', '/worker/status');
    expect(res.status).toBe(401);
  });

  it('com Bearer + Redis/alvos offline → services reachable:false', async () => {
    // getAggregatedWorkerStatus mock retorna reachable:false em ambos
    // os serviços (simulando fetch falhando e Redis offline).
    const getStatus = mock(() =>
      Promise.resolve({
        success: true as const,
        services: [
          { name: 'ingestor' as const, reachable: false, error: 'fetch failed' },
          { name: 'dispatcher' as const, reachable: false, error: 'fetch failed' },
        ],
        pipeline: { queueA: null, queueB: null },
      }),
    );
    const app = makeApp({
      getAggregatedWorkerStatus: getStatus as never,
      listDlqItems: mock(() => Promise.resolve({} as never)) as never,
      requeueDlqItem: mock(() => Promise.resolve({ success: false })) as never,
      removeDlqItem: mock(() => Promise.resolve(false)) as never,
      purgeDlq: mock(() => Promise.resolve(0)) as never,
    });

    const res = await call(app, 'GET', '/worker/status', { headers: await authedHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      services: Array<{ name: string; reachable: boolean }>;
      pipeline: { queueA: number | null; queueB: number | null };
    };
    expect(body.success).toBe(true);
    expect(body.services).toHaveLength(2);
    expect(body.services.every((s) => !s.reachable)).toBe(true);
  });

  it('com Bearer + Redis offline → queueA/queueB null', async () => {
    const getStatus = mock(() =>
      Promise.resolve({
        success: true as const,
        services: [
          { name: 'ingestor' as const, reachable: true },
          { name: 'dispatcher' as const, reachable: true },
        ],
        pipeline: { queueA: null, queueB: null },
      }),
    );
    const app = makeApp({
      getAggregatedWorkerStatus: getStatus as never,
      listDlqItems: mock(() => Promise.resolve({} as never)) as never,
      requeueDlqItem: mock(() => Promise.resolve({ success: false })) as never,
      removeDlqItem: mock(() => Promise.resolve(false)) as never,
      purgeDlq: mock(() => Promise.resolve(0)) as never,
    });
    const res = await call(app, 'GET', '/worker/status', { headers: await authedHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      pipeline: { queueA: number | null; queueB: number | null };
    };
    expect(body.pipeline.queueA).toBeNull();
    expect(body.pipeline.queueB).toBeNull();
  });
});

describe('GET /api/admin/worker/dlq', () => {
  it('com Bearer + offset=0 → lista itens', async () => {
    const listDlq = mock(() =>
      Promise.resolve({
        items: [
          {
            id: '1',
            failureReason: 'send_failed',
            attempts: 3,
            lastError: 'x',
            failedAt: '2026-08-04T00:00:00Z',
            reprocessed: false,
          },
        ],
        total: 1,
        totalFiltered: 1,
        offset: 0,
        limit: 20,
      }),
    );
    const app = makeApp({
      getAggregatedWorkerStatus: mock(() => Promise.resolve({} as never)) as never,
      listDlqItems: listDlq as never,
      requeueDlqItem: mock(() => Promise.resolve({ success: false })) as never,
      removeDlqItem: mock(() => Promise.resolve(false)) as never,
      purgeDlq: mock(() => Promise.resolve(0)) as never,
    });
    const res = await call(app, 'GET', '/worker/dlq?offset=0', { headers: await authedHeaders() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items?: unknown[]; total?: number };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.total).toBe(1);
    expect(listDlq).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/admin/worker/dlq/requeue', () => {
  it('sem Bearer → 401', async () => {
    const app = makeApp({
      getAggregatedWorkerStatus: mock(() => Promise.resolve({} as never)) as never,
      listDlqItems: mock(() => Promise.resolve({} as never)) as never,
      requeueDlqItem: mock(() => Promise.resolve({ success: false })) as never,
      removeDlqItem: mock(() => Promise.resolve(false)) as never,
      purgeDlq: mock(() => Promise.resolve(0)) as never,
    });
    const res = await call(app, 'POST', '/worker/dlq/requeue?id=abc');
    expect(res.status).toBe(401);
  });

  it('com Bearer → 200 success + targetStream', async () => {
    const requeueDlq = mock(() =>
      Promise.resolve({ success: true, targetStream: 'omestre:mirror:raw' }),
    );
    const app = makeApp({
      getAggregatedWorkerStatus: mock(() => Promise.resolve({} as never)) as never,
      listDlqItems: mock(() => Promise.resolve({} as never)) as never,
      requeueDlqItem: requeueDlq as never,
      removeDlqItem: mock(() => Promise.resolve(false)) as never,
      purgeDlq: mock(() => Promise.resolve(0)) as never,
    });
    const res = await call(app, 'POST', '/worker/dlq/requeue?id=item-1', {
      headers: await authedHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; targetStream?: string };
    expect(body.success).toBe(true);
    expect(body.targetStream).toBe('omestre:mirror:raw');
    expect(requeueDlq).toHaveBeenCalledWith('item-1');
  });
});

describe('POST /api/admin/worker/dlq/remove', () => {
  it('com Bearer → 200 success', async () => {
    const removeDlq = mock(() => Promise.resolve(true));
    const app = makeApp({
      getAggregatedWorkerStatus: mock(() => Promise.resolve({} as never)) as never,
      listDlqItems: mock(() => Promise.resolve({} as never)) as never,
      requeueDlqItem: mock(() => Promise.resolve({ success: false })) as never,
      removeDlqItem: removeDlq as never,
      purgeDlq: mock(() => Promise.resolve(0)) as never,
    });
    const res = await call(app, 'POST', '/worker/dlq/remove?id=item-2', {
      headers: await authedHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(removeDlq).toHaveBeenCalledWith('item-2');
  });
});

describe('POST /api/admin/worker/dlq/purge', () => {
  it('com Bearer → 200 removed', async () => {
    const purge = mock(() => Promise.resolve(7));
    const app = makeApp({
      getAggregatedWorkerStatus: mock(() => Promise.resolve({} as never)) as never,
      listDlqItems: mock(() => Promise.resolve({} as never)) as never,
      requeueDlqItem: mock(() => Promise.resolve({ success: false })) as never,
      removeDlqItem: mock(() => Promise.resolve(false)) as never,
      purgeDlq: purge as never,
    });
    const res = await call(app, 'POST', '/worker/dlq/purge', {
      headers: await authedHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; removed?: number };
    expect(body.success).toBe(true);
    expect(body.removed).toBe(7);
    expect(purge).toHaveBeenCalledTimes(1);
  });
});
