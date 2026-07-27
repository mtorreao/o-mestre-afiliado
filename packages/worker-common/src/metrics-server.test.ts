/**
 * Testes das funções de orquestração (wrapper) de metrics-server.ts que
 * ainda vivem neste módulo — a parte de I/O do Bun.serve fica no caller.
 *
 * Cobre:
 *   - createCounter / incrementCounter (com e sem labels, nome inexistente)
 *   - createHistogram / observeHistogram (buckets, nome inexistente)
 *   - getMetrics (renderização Prometheus via renderMetricLine + join)
 *   - trackError (wrapper que delega para a função pura)
 *   - getStatusResponse (DLQ indisponível → 0, queueSize override/provider)
 *   - registerStepTrackers / setStatusMeta / setQueueSizeProvider / resetMetrics
 *
 * Não sobe o servidor (Bun.serve) e não requer Redis — countDLQ/provider
 * são resolvidos com fallback gracioso.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { StepTracker } from './step-tracker.ts';
import {
  createCounter,
  createHistogram,
  getMetrics,
  getStatusResponse,
  incrementCounter,
  observeHistogram,
  registerStepTrackers,
  resetMetrics,
  setQueueSizeProvider,
  setStatusMeta,
  trackError,
} from './metrics-server.ts';

// Stub da DLQ para não depender de Redis em ambiente de teste.
mock.module('./dead-letter-queue.ts', () => ({
  countDLQ: mock(() => Promise.resolve(0)),
  listDLQ: mock(() => Promise.resolve({ items: [], total: 0, totalFiltered: 0 })),
  requeueFromDLQ: mock(() => Promise.resolve(true)),
  removeFromDLQ: mock(() => Promise.resolve(true)),
  purgeOldDLQItems: mock(() => Promise.resolve(0)),
}));

beforeEach(() => {
  resetMetrics();
});

afterEach(() => {
  resetMetrics();
});

describe('createCounter / incrementCounter', () => {
  it('createCounter é idempotente (segundo create não sobrescreve)', () => {
    createCounter('req_total', 'Requests');
    createCounter('req_total', 'Requests (ignored)');
    incrementCounter('req_total');
    expect(getMetrics()).toContain('req_total 1');
  });

  it('incrementa counter simples', () => {
    createCounter('hits', 'Hits');
    incrementCounter('hits');
    incrementCounter('hits');
    expect(getMetrics()).toContain('hits 2');
  });

  it('incrementa counter rotulado por combinação de labels', () => {
    createCounter('by_instance', 'By instance', ['instance']);
    incrementCounter('by_instance', { instance: 'a' });
    incrementCounter('by_instance', { instance: 'a' });
    incrementCounter('by_instance', { instance: 'b' });
    const out = getMetrics();
    expect(out).toContain('by_instance{instance="a"} 2');
    expect(out).toContain('by_instance{instance="b"} 1');
  });

  it('avisa e ignora quando o counter não existe', () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      incrementCounter('does_not_exist');
    } finally {
      console.warn = original;
    }
    expect(warn).toHaveBeenCalled();
  });
});

describe('createHistogram / observeHistogram', () => {
  it('createHistogram é idempotente', () => {
    createHistogram('lat', 'Latency');
    createHistogram('lat', 'Latency (ignored)');
    observeHistogram('lat', 0.1);
    expect(getMetrics()).toContain('lat_count 1');
  });

  it('acumula observações e preenche buckets', () => {
    createHistogram('lat', 'Latency', [], [0.05, 0.1, 1]);
    observeHistogram('lat', 0.08);
    observeHistogram('lat', 0.5);
    const out = getMetrics();
    expect(out).toContain('# TYPE lat histogram');
    // 0.08 cai em le<=0.1 e le<=1; 0.5 cai só em le<=1
    expect(out).toContain('lat_bucket{le="0.05"} 0');
    expect(out).toContain('lat_bucket{le="0.1"} 1');
    expect(out).toContain('lat_bucket{le="1"} 2');
    expect(out).toContain('lat_sum 0.58');
    expect(out).toContain('lat_count 2');
  });

  it('observa histogram rotulado', () => {
    createHistogram('dur', 'Dur', ['route'], [1]);
    observeHistogram('dur', 0.2, { route: 'x' });
    expect(getMetrics()).toContain('dur_count{route="x"} 1');
  });

  it('avisa e ignora quando o histogram não existe', () => {
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      observeHistogram('nope', 1);
    } finally {
      console.warn = original;
    }
    expect(warn).toHaveBeenCalled();
  });
});

describe('getMetrics', () => {
  it('produz texto Prometheus terminado em newline', () => {
    createCounter('c', 'C');
    incrementCounter('c');
    const out = getMetrics();
    expect(out.startsWith('# HELP c C')).toBe(true);
    expect(out.endsWith('\n')).toBe(true);
  });

  it('intercala counters e histograms', () => {
    createCounter('a', 'A');
    incrementCounter('a');
    createHistogram('b', 'B', [], [1]);
    observeHistogram('b', 0.5);
    const out = getMetrics();
    expect(out).toContain('a 1');
    expect(out).toContain('b_count 1');
  });
});

describe('trackError', () => {
  it('registra e agrega erros no mapa module-level', async () => {
    trackError('falha X');
    trackError('falha X');
    trackError('falha Y');
    const res = await getStatusResponse('svc', 'stream');
    const messages = res.errors.map((e) => `${e.message}:${e.count}`).sort();
    expect(messages).toContain('falha X:2');
    expect(messages).toContain('falha Y:1');
  });
});

describe('getStatusResponse', () => {
  it('DLQ indisponível → dlqCount 0 (fallback gracioso)', async () => {
    const res = await getStatusResponse('ingestor', 'mirror:in');
    expect(res.service).toBe('ingestor');
    expect(res.dlqCount).toBe(0);
  });

  it('queueSize vem do override quando não há provider', async () => {
    setStatusMeta({ queueSize: 42 });
    const res = await getStatusResponse('ingestor', 'mirror:in');
    expect(res.queueSize).toBe(42);
  });

  it('queueSize vem do provider quando configurado', async () => {
    setQueueSizeProvider(async () => 7);
    const res = await getStatusResponse('ingestor', 'mirror:in');
    expect(res.queueSize).toBe(7);
  });

  it('provider que lança mantém override/null', async () => {
    setStatusMeta({ queueSize: 5 });
    setQueueSizeProvider(async () => {
      throw new Error('redis down');
    });
    const res = await getStatusResponse('ingestor', 'mirror:in');
    expect(res.queueSize).toBe(5);
  });

  it('inclui stepDurations e counters no /status', async () => {
    const tracker = new StepTracker();
    tracker.observe(100);
    registerStepTrackers({ parse: tracker });
    createCounter('ops_total', 'Ops');
    incrementCounter('ops_total');
    const res = await getStatusResponse('ingestor', 'mirror:in');
    expect(res.stepDurations.parse?.count).toBe(1);
    expect(res.counters['ops_total']).toBe(1);
  });

  it('mode vem do statusOverride', async () => {
    setStatusMeta({ mode: 'prod' });
    const res = await getStatusResponse('ingestor', 'mirror:in');
    expect(res.mode).toBe('prod');
  });
});
