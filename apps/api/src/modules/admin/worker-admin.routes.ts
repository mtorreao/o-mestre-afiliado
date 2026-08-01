import { Elysia } from 'elysia';
import { createJwtPlugin, getSuperAdminUser } from '../../middleware/auth.ts';
import type { AuthUser } from '../../middleware/auth.ts';
import {
  getAggregatedWorkerStatus,
  listDlqItems,
  requeueDlqItem,
  removeDlqItem,
  purgeDlq,
} from '../../services/worker-metrics.ts';
import type { ListDlqFilters } from '../../services/worker-metrics.ts';

type JwtVerifier = {
  verify: (token: string) => Promise<Record<string, unknown> | null | false>;
};

type SuperAdminResolver = (jwt: JwtVerifier, headers: Headers) => Promise<AuthUser | null>;

export interface WorkerAdminRoutesDeps {
  getSuperAdmin?: SuperAdminResolver;
  getAggregatedWorkerStatus?: typeof getAggregatedWorkerStatus;
  listDlqItems?: (filters: ListDlqFilters) => ReturnType<typeof listDlqItems>;
  requeueDlqItem?: typeof requeueDlqItem;
  removeDlqItem?: typeof removeDlqItem;
  purgeDlq?: typeof purgeDlq;
}

function deny(set: { status?: number | string }) {
  set.status = 403;
  return { success: false, error: 'Acesso restrito ao super admin' };
}

export function createWorkerAdminRoutes(deps: WorkerAdminRoutesDeps = {}) {
  const {
    getSuperAdmin = getSuperAdminUser,
    getAggregatedWorkerStatus: getStatus = getAggregatedWorkerStatus,
    listDlqItems: listDlq = listDlqItems,
    requeueDlqItem: requeueDlq = requeueDlqItem,
    removeDlqItem: removeDlq = removeDlqItem,
    purgeDlq: purge = purgeDlq,
  } = deps;

  return new Elysia()
    .use(createJwtPlugin())
    .get('/api/worker/status', async ({ jwt, request: { headers }, set }) => {
      if (!(await getSuperAdmin(jwt, headers))) return deny(set);
      return getStatus();
    })
    .get('/api/worker/dlq', async ({ jwt, request: { headers }, query, set }) => {
      if (!(await getSuperAdmin(jwt, headers))) return deny(set);
      const q = query as Record<string, string>;
      return listDlq({
        offset: q.offset ? parseInt(q.offset, 10) : 0,
        limit: q.limit ? parseInt(q.limit, 10) : 20,
        queue: q.queue as 'A' | 'B' | undefined,
        failureReason: q.reason || undefined,
        since: q.since ? parseInt(q.since, 10) || undefined : undefined,
      });
    })
    .post('/api/worker/dlq/requeue', async ({ jwt, request: { headers }, query, set }) => {
      if (!(await getSuperAdmin(jwt, headers))) return deny(set);
      const { id } = query as { id?: string };
      if (!id) {
        set.status = 400;
        return { success: false, error: 'ID é obrigatório' };
      }
      return requeueDlq(id);
    })
    .post('/api/worker/dlq/remove', async ({ jwt, request: { headers }, query, set }) => {
      if (!(await getSuperAdmin(jwt, headers))) return deny(set);
      const { id } = query as { id?: string };
      if (!id) {
        set.status = 400;
        return { success: false, error: 'ID é obrigatório' };
      }
      return removeDlq(id);
    })
    .post('/api/worker/dlq/purge', async ({ jwt, request: { headers }, set }) => {
      if (!(await getSuperAdmin(jwt, headers))) return deny(set);
      return purge();
    });
}

export const workerAdminRoutes = createWorkerAdminRoutes();
