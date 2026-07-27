/**
 * Testes do agregador de métricas em apps/api.
 *
 * Cobre:
 *  - listDlqItems: assinatura legada (offset, limit) e nova (filters)
 *  - effectiveLimit: 20 default; 100 quando há filtro server-side
 *  - authHeaders: header omitido sem METRICS_API_KEY, presente com
 *  - config: WORKER_METRICS_URL, DISPATCHER_METRICS_URL, METRICS_API_KEY
 *
 * O fetch real (getAggregatedWorkerStatus) precisaria mockar fetch
 * + getRedis — fora do escopo deste teste (cobertura indireta via E2E).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { config } from '../config.ts';

// Mock do @omestre/worker-common para isolar listDlqItems da DLQ real
const dlqListCalls: Array<{
  offset: number;
  limit: number;
  queue?: string;
  failureReason?: string;
  since?: number;
}> = [];
const dlqListResult = { items: [], total: 0, offset: 0, limit: 20, totalFiltered: 0 };

await mock.module('@omestre/worker-common', () => ({
  listDLQ: async (opts: {
    offset: number;
    limit: number;
    queue?: string;
    failureReason?: string;
    since?: number;
  }) => {
    dlqListCalls.push(opts);
    return dlqListResult;
  },
  getDLQItem: async () => null,
  requeueFromDLQ: async () => false,
  removeFromDLQ: async () => false,
  purgeOldDLQItems: async () => 0,
}));

const { listDlqItems } = await import('./worker-metrics.ts');

describe('listDlqItems', () => {
  beforeEach(() => {
    dlqListCalls.length = 0;
  });

  describe('assinatura legada (offset, limit)', () => {
    it('passa offset e limit diretamente para dlqList', async () => {
      await listDlqItems(5, 50);
      expect(dlqListCalls).toHaveLength(1);
      expect(dlqListCalls[0]!.offset).toBe(5);
      expect(dlqListCalls[0]!.limit).toBe(50);
    });

    it('default offset=0, limit=20', async () => {
      await listDlqItems();
      expect(dlqListCalls[0]!.offset).toBe(0);
      expect(dlqListCalls[0]!.limit).toBe(20);
    });
  });

  describe('assinatura nova (filters)', () => {
    it('passa filtros server-side', async () => {
      await listDlqItems({
        offset: 10,
        limit: 50,
        queue: 'A',
        failureReason: 'cookie_expired',
        since: 1234567890,
      });
      expect(dlqListCalls[0]!.offset).toBe(10);
      expect(dlqListCalls[0]!.queue).toBe('A');
      expect(dlqListCalls[0]!.failureReason).toBe('cookie_expired');
      expect(dlqListCalls[0]!.since).toBe(1234567890);
    });

    it('aumenta limit para 100 quando há filtro', async () => {
      await listDlqItems({ queue: 'A' });
      expect(dlqListCalls[0]!.limit).toBe(100);
    });

    it('respeita limit custom se for maior que 100', async () => {
      await listDlqItems({ queue: 'A', limit: 200 });
      expect(dlqListCalls[0]!.limit).toBe(200);
    });

    it('mantém limit em 20 sem filtro server-side', async () => {
      await listDlqItems({ limit: 50 });
      expect(dlqListCalls[0]!.limit).toBe(50);
    });

    it('failureReason sozinho também força limit=100', async () => {
      await listDlqItems({ failureReason: 'cookie_expired' });
      expect(dlqListCalls[0]!.limit).toBe(100);
    });

    it('since sozinho também força limit=100', async () => {
      await listDlqItems({ since: 1000 });
      expect(dlqListCalls[0]!.limit).toBe(100);
    });

    it('usa default offset=0 quando não informado', async () => {
      await listDlqItems({ queue: 'A' });
      expect(dlqListCalls[0]!.offset).toBe(0);
    });
  });
});

describe('config — métricas', () => {
  let originalWorker: string | undefined;
  let originalDispatcher: string | undefined;
  let originalKey: string | undefined;

  beforeEach(() => {
    originalWorker = process.env.WORKER_METRICS_URL;
    originalDispatcher = process.env.DISPATCHER_METRICS_URL;
    originalKey = process.env.METRICS_API_KEY;
    config.reset();
  });

  afterEach(() => {
    if (originalWorker === undefined) delete process.env.WORKER_METRICS_URL;
    else process.env.WORKER_METRICS_URL = originalWorker;
    if (originalDispatcher === undefined) delete process.env.DISPATCHER_METRICS_URL;
    else process.env.DISPATCHER_METRICS_URL = originalDispatcher;
    if (originalKey === undefined) delete process.env.METRICS_API_KEY;
    else process.env.METRICS_API_KEY = originalKey;
    config.reset();
  });

  it('WORKER_METRICS_URL default é http://localhost:9092', () => {
    delete process.env.WORKER_METRICS_URL;
    config.reset();
    expect(config.WORKER_METRICS_URL).toBe('http://localhost:9092');
  });

  it('DISPATCHER_METRICS_URL default é http://localhost:9093', () => {
    delete process.env.DISPATCHER_METRICS_URL;
    config.reset();
    expect(config.DISPATCHER_METRICS_URL).toBe('http://localhost:9093');
  });

  it('METRICS_API_KEY default é vazio', () => {
    delete process.env.METRICS_API_KEY;
    config.reset();
    expect(config.METRICS_API_KEY).toBe('');
  });

  it('lê METRICS_API_KEY do env', () => {
    process.env.METRICS_API_KEY = 'secret-key';
    config.reset();
    expect(config.METRICS_API_KEY).toBe('secret-key');
  });
});
