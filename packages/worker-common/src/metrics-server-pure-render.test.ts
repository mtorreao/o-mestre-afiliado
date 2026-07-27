/**
 * Testes das NOVAS funções PURAS de renderização/serialização do
 * metrics-server-pure.ts extraídas de metrics-server.ts:
 *   - promLabelKeyValue         (replica labelKey)
 *   - labelsFromKey             (reconstrói labels da chave)
 *   - renderMetricLine          (counter simples / rotulado / histogram)
 *   - joinPrometheusLines       (junta linhas + newline final)
 *   - buildCountersSnapshot     (counters p/ /status)
 *   - trackError                (inserção/agregação/eviction LRU)
 *
 * Sem Bun.serve, sem Redis — 100% determinístico.
 */
import { describe, expect, it } from 'bun:test';
import type { CounterMetric, HistogramMetric, Metric } from './metrics-server.ts';
import type { TrackedError } from './metrics-server.ts';
import {
  buildCountersSnapshot,
  joinPrometheusLines,
  labelsFromKey,
  promLabelKeyValue,
  renderMetricLine,
  trackError,
} from './metrics-server-pure.ts';

function counter(
  name: string,
  help: string,
  value: number,
  labelNames: string[] = [],
  counts: Record<string, number> = {},
): [string, Metric] {
  const c: CounterMetric = {
    value,
    help,
    labelNames,
    counts: new Map(Object.entries(counts)),
    type: 'counter',
  };
  return [name, c];
}

function histogram(
  name: string,
  help: string,
  labelNames: string[],
  observations: Record<string, { sum: number; count: number }>,
): [string, Metric] {
  const h: HistogramMetric = {
    help,
    labelNames,
    buckets: [0.5, 1, 5],
    observations: new Map(
      Object.entries(observations).map(([key, obs]) => [
        key,
        {
          sum: obs.sum,
          count: obs.count,
          bucketCounts: [
            { le: 0.5, count: obs.sum <= 0.5 ? obs.count : 0 },
            { le: 1, count: obs.sum <= 1 ? obs.count : 0 },
            { le: 5, count: obs.sum <= 5 ? obs.count : 0 },
          ],
        },
      ]),
    ),
    type: 'histogram',
  };
  return [name, h];
}

describe('promLabelKeyValue', () => {
  it('junta valores por vírgula', () => {
    expect(promLabelKeyValue({ instance: 'a', status: 'ok' })).toBe('a,ok');
  });
  it('ordem dos valores segue Object.values', () => {
    expect(promLabelKeyValue({ b: '2', a: '1' })).toBe('2,1');
  });
  it('vazio sem labels', () => {
    expect(promLabelKeyValue({})).toBe('');
  });
});

describe('labelsFromKey', () => {
  it('reconstrói labels a partir da chave e labelNames', () => {
    expect(labelsFromKey('a,ok', ['instance', 'status'])).toEqual({
      instance: 'a',
      status: 'ok',
    });
  });
  it('preenche vazio quando faltam valores', () => {
    expect(labelsFromKey('a', ['instance', 'status'])).toEqual({
      instance: 'a',
      status: '',
    });
  });
  it('inverso de promLabelKeyValue', () => {
    const labels = { x: '1', y: '2', z: '3' };
    expect(labelsFromKey(promLabelKeyValue(labels), ['x', 'y', 'z'])).toEqual(labels);
  });
});

describe('renderMetricLine — counter simples', () => {
  it('emite HELP/TYPE + valor', () => {
    const [name, metric] = counter('http_requests_total', 'Total HTTP', 42);
    const lines = renderMetricLine(name, metric);
    expect(lines).toEqual([
      '# HELP http_requests_total Total HTTP',
      '# TYPE http_requests_total counter',
      'http_requests_total 42',
    ]);
  });
});

describe('renderMetricLine — counter rotulado', () => {
  it('emite uma série por combinação de labels', () => {
    const [name, metric] = counter('pipeline_total', 'Pipeline', 0, ['instance'], { a: 10, b: 5 });
    const lines = renderMetricLine(name, metric);
    expect(lines).toContain('# HELP pipeline_total Pipeline');
    expect(lines).toContain('# TYPE pipeline_total counter');
    expect(lines).toContain('pipeline_total{instance="a"} 10');
    expect(lines).toContain('pipeline_total{instance="b"} 5');
    expect(lines).toHaveLength(4);
  });
});

describe('renderMetricLine — histogram', () => {
  it('emite _bucket/_count/_sum com labels escapados', () => {
    const [name, metric] = histogram('latency', 'Latency', ['route'], {
      read: { sum: 0.3, count: 2 },
    });
    const lines = renderMetricLine(name, metric);
    expect(lines[0]).toBe('# HELP latency Latency');
    expect(lines[1]).toBe('# TYPE latency histogram');
    // série rotulada route="read"
    expect(lines).toContain('latency_bucket{route="read"}{le="0.5"} 2');
    expect(lines).toContain('latency_bucket{route="read"}{le="+Inf"} 2');
    expect(lines).toContain('latency_count{route="read"} 2');
    expect(lines).toContain('latency_sum{route="read"} 0.3');
  });

  it('sem labels rotulados usa chave vazia', () => {
    const [name, metric] = histogram('lat', 'L', [], { '': { sum: 1, count: 1 } });
    const lines = renderMetricLine(name, metric);
    expect(lines).toContain('lat_sum 1');
    expect(lines).toContain('lat_count 1');
  });
});

describe('joinPrometheusLines', () => {
  it('junta com newline e termina com newline', () => {
    expect(joinPrometheusLines(['a', 'b'])).toBe('a\nb\n');
  });
  it('funciona com array vazio', () => {
    expect(joinPrometheusLines([])).toBe('\n');
  });
});

describe('buildCountersSnapshot', () => {
  it('counter simples vira {name: value}', () => {
    const m = new Map<string, Metric>([counter('x_total', 'X', 7)]);
    expect(buildCountersSnapshot(m)).toEqual({ x_total: 7 });
  });

  it('counter rotulado vira {name{k=v}: value}', () => {
    const m = new Map<string, Metric>([counter('y_total', 'Y', 0, ['instance'], { a: 3, b: 9 })]);
    expect(buildCountersSnapshot(m)).toEqual({
      'y_total{instance=a}': 3,
      'y_total{instance=b}': 9,
    });
  });

  it('ignora histograms (só counters)', () => {
    const m = new Map<string, Metric>([
      counter('c_total', 'C', 5),
      histogram('h', 'H', [], { '': { sum: 1, count: 1 } }),
    ]);
    expect(buildCountersSnapshot(m)).toEqual({ c_total: 5 });
  });

  it('mapa vazio → snapshot vazio', () => {
    expect(buildCountersSnapshot(new Map())).toEqual({});
  });
});

describe('trackError', () => {
  const T0 = '2024-01-01T00:00:00.000Z';
  const T1 = '2024-01-02T00:00:00.000Z';

  it('insere novo erro com count 1 e horário informado', () => {
    const out = trackError(new Map(), 'boom', 20, T0);
    expect(out.get('boom')).toEqual({ time: T0, message: 'boom', count: 1 });
  });

  it('agrega erro existente (count++ e atualiza horário)', () => {
    const prev = new Map<string, TrackedError>([['boom', { time: T0, message: 'boom', count: 1 }]]);
    const out = trackError(prev, 'boom', 20, T1);
    expect(out.get('boom')).toEqual({ time: T1, message: 'boom', count: 2 });
  });

  it('não muta o mapa de entrada (função pura)', () => {
    const prev = new Map<string, TrackedError>([['boom', { time: T0, message: 'boom', count: 1 }]]);
    trackError(prev, 'bang', 20, T1);
    expect(prev.size).toBe(1);
    expect(prev.has('bang')).toBe(false);
  });

  it('evicta o mais antigo quando estoura maxTracked', () => {
    const prev = new Map<string, TrackedError>();
    // semeia 2 erros (max=2): oldest=T0, newer=T1
    let m = trackError(prev, 'old', 2, T0);
    m = trackError(m, 'new', 2, T1);
    // terceiro dispara eviction do mais antigo ('old')
    m = trackError(m, 'third', 2, '2024-01-03T00:00:00.000Z');
    expect(m.has('old')).toBe(false);
    expect(m.has('new')).toBe(true);
    expect(m.has('third')).toBe(true);
    expect(m.size).toBe(2);
  });

  it('não evicta enquanto abaixo do limite', () => {
    const m = trackError(new Map(), 'only', 5, T0);
    expect(m.size).toBe(1);
  });
});
