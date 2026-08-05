/**
 * Rotas de worker status no admin-api (Hono).
 *
 * GET   /api/admin/worker/status              → status agregado dos workers + XLEN dos streams
 * GET   /api/admin/worker/dlq?offset&limit&queue&reason&since
 *                                              → lista itens da DLQ
 * POST  /api/admin/worker/dlq/requeue?id=     → re-enfileira item no stream correto
 * POST  /api/admin/worker/dlq/remove?id=      → remove item da DLQ
 * POST  /api/admin/worker/dlq/purge           → remove itens antigos (purgeOldDLQItems)
 *
 * Auth: sessionAuth() — admin-api é single-user. Sem getSuperAdmin (não há
 * distinção admin/non-admin aqui).
 *
 * Deps injetáveis — facilitam testes sem rede/Redis:
 *   - getAggregatedWorkerStatus, listDlqItems, requeueDlqItem,
 *     removeDlqItem, purgeDlq
 */

import { Hono } from 'hono';
import type { Logger } from '../config.ts';
import { sessionAuth, type AuthEnv } from '../auth.ts';
import {
  getAggregatedWorkerStatus,
  listDlqItems,
  requeueDlqItem,
  removeDlqItem,
  purgeDlq,
  type WorkerMetricsDeps,
} from '../services/worker-metrics.ts';

export interface WorkerDeps {
  log?: Logger;
  metrics?: WorkerMetricsDeps;
  getAggregatedWorkerStatus?: typeof getAggregatedWorkerStatus;
  listDlqItems?: typeof listDlqItems;
  requeueDlqItem?: typeof requeueDlqItem;
  removeDlqItem?: typeof removeDlqItem;
  purgeDlq?: typeof purgeDlq;
}

export function createWorkerRoutes(deps: WorkerDeps = {}) {
  const {
    log,
    metrics,
    getAggregatedWorkerStatus: getStatus = getAggregatedWorkerStatus,
    listDlqItems: listDlq = listDlqItems,
    requeueDlqItem: requeueDlq = requeueDlqItem,
    removeDlqItem: removeDlq = removeDlqItem,
    purgeDlq: purge = purgeDlq,
  } = deps;

  const app = new Hono<AuthEnv>();
  app.use('*', sessionAuth());

  // GET /api/admin/worker/status
  app.get('/worker/status', async (c) => {
    try {
      // Se `metrics` foi injetado (teste), usa ele; senão, aceita uma config
      // padrão vazia e o orchestrator decide (nunca alcançado em testes por
      // causa de mock).
      const deps = metrics ?? ({ config: undefined as never } as WorkerMetricsDeps);
      const result = await getStatus(deps);
      return c.json(result);
    } catch (err) {
      log?.error('Erro ao buscar status do worker', { error: String(err) });
      return c.json({ success: false, error: 'Erro interno' });
    }
  });

  // GET /api/admin/worker/dlq?offset&limit&queue&reason&since
  app.get('/worker/dlq', async (c) => {
    try {
      const offsetRaw = c.req.query('offset');
      const limitRaw = c.req.query('limit');
      const queueRaw = c.req.query('queue');
      const reasonRaw = c.req.query('reason');
      const sinceRaw = c.req.query('since');

      const result = await listDlq({
        ...(offsetRaw ? { offset: parseInt(offsetRaw, 10) } : {}),
        ...(limitRaw ? { limit: parseInt(limitRaw, 10) } : {}),
        ...(queueRaw === 'A' || queueRaw === 'B' ? { queue: queueRaw } : {}),
        ...(reasonRaw ? { failureReason: reasonRaw } : {}),
        ...(sinceRaw
          ? { since: Number.isFinite(parseInt(sinceRaw, 10)) ? parseInt(sinceRaw, 10) : undefined }
          : {}),
      });
      return c.json(result);
    } catch (err) {
      log?.error('Erro ao listar DLQ', { error: String(err) });
      return c.json({ success: false, error: 'Erro interno' });
    }
  });

  // POST /api/admin/worker/dlq/requeue?id=X
  app.post('/worker/dlq/requeue', async (c) => {
    const id = c.req.query('id');
    if (!id) {
      return c.json({ success: false, error: 'ID é obrigatório' });
    }
    try {
      return c.json(await requeueDlq(id));
    } catch (err) {
      log?.error('Erro ao re-enfileirar item da DLQ', { error: String(err) });
      return c.json({ success: false, error: 'Erro interno' });
    }
  });

  // POST /api/admin/worker/dlq/remove?id=X
  app.post('/worker/dlq/remove', async (c) => {
    const id = c.req.query('id');
    if (!id) {
      return c.json({ success: false, error: 'ID é obrigatório' });
    }
    try {
      const ok = await removeDlq(id);
      return c.json({ success: ok });
    } catch (err) {
      log?.error('Erro ao remover item da DLQ', { error: String(err) });
      return c.json({ success: false, error: 'Erro interno' });
    }
  });

  // POST /api/admin/worker/dlq/purge
  app.post('/worker/dlq/purge', async (c) => {
    try {
      const removed = await purge();
      return c.json({ success: true, removed });
    } catch (err) {
      log?.error('Erro ao purgar DLQ', { error: String(err) });
      return c.json({ success: false, error: 'Erro interno' });
    }
  });

  return app;
}

// Local mini-re-typer — espelha a assinatura de listDlqItems mas aceita filtros parciais.
async function listDlq(
  filters: Parameters<typeof listDlqItems>[0],
): ReturnType<typeof listDlqItems> {
  return await listDlqItems(filters);
}
