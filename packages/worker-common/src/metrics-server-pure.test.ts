/**
 * Testes das funções PURAS do servidor de métricas (metrics-server-pure.ts).
 *
 * Sem Bun.serve, sem Redis, sem DLQ — apenas formatação de labels
 * Prometheus, uptime e montagem do StatusResponse.
 */
import { describe, expect, it } from 'bun:test';
import { StepTracker } from './step-tracker.ts';
import {
  authenticateMetricsRequest,
  buildStatusResponse,
  escapePromLabel,
  formatLabels,
  formatUptime,
  type StatusResponseInput,
} from './metrics-server-pure.ts';

describe('escapePromLabel', () => {
  it('escapa barra invertida', () => {
    expect(escapePromLabel('a\\b')).toBe('a\\\\b');
  });

  it('escapa aspas duplas', () => {
    expect(escapePromLabel('a"b')).toBe('a\\"b');
  });

  it('escapa quebra de linha', () => {
    expect(escapePromLabel('a\nb')).toBe('a\\nb');
  });

  it('não altera string sem caracteres especiais', () => {
    expect(escapePromLabel('simples')).toBe('simples');
  });

  it('escapa combinação de especiais', () => {
    expect(escapePromLabel('x"\\y\nz')).toBe('x\\"\\\\y\\nz');
  });
});

describe('formatLabels', () => {
  it('formata labels simples', () => {
    expect(formatLabels({ instance: 'a', status: 'ok' })).toBe('{instance="a",status="ok"}');
  });

  it('retorna string vazia sem labels', () => {
    expect(formatLabels({})).toBe('');
  });

  it('escapa valores com aspas', () => {
    expect(formatLabels({ name: 'jo"hn' })).toBe('{name="jo\\"hn"}');
  });
});

describe('formatUptime', () => {
  it('formata apenas minutos e segundos', () => {
    expect(formatUptime(65_000)).toBe('1m 5s');
  });

  it('formata horas', () => {
    expect(formatUptime(3 * 3600 * 1000 + 2 * 60 * 1000 + 9 * 1000)).toBe('3h 2m 9s');
  });

  it('formata dias', () => {
    expect(formatUptime(2 * 86400 * 1000 + 4 * 3600 * 1000 + 5 * 60 * 1000 + 1 * 1000)).toBe(
      '2d 4h 5m 1s',
    );
  });

  it('zero → "0m 0s"', () => {
    expect(formatUptime(0)).toBe('0m 0s');
  });
});

describe('buildStatusResponse', () => {
  const baseInput = (over: Partial<StatusResponseInput> = {}): StatusResponseInput => ({
    serviceName: 'ingestor',
    startTimeMs: 1_000_000,
    stepTrackers: {},
    nowMs: 1_000_000 + 65_000,
    dlqCount: 0,
    queueSize: null,
    statusOverrides: {},
    recentErrors: [],
    countersSnapshot: {},
    ...over,
  });

  it('monta resposta com uptime e startTime', () => {
    const res = buildStatusResponse(baseInput());
    expect(res.service).toBe('ingestor');
    expect(res.status).toBe('healthy');
    expect(res.uptime).toBe('1m 5s');
    expect(res.uptimeSeconds).toBe(65);
    expect(res.startTime).toBe(new Date(1_000_000).toISOString());
  });

  it('mode vem do override ou default "unknown"', () => {
    expect(buildStatusResponse(baseInput()).mode).toBe('unknown');
    expect(buildStatusResponse(baseInput({ statusOverrides: { mode: 'prod' } })).mode).toBe('prod');
  });

  it('propaga dlqCount, queueSize e counters', () => {
    const res = buildStatusResponse(
      baseInput({ dlqCount: 3, queueSize: 12, countersSnapshot: { x_total: 7 } }),
    );
    expect(res.dlqCount).toBe(3);
    expect(res.queueSize).toBe(12);
    expect(res.counters).toEqual({ x_total: 7 });
  });

  it('snapshots dos step trackers via StepTracker real', () => {
    const tracker = new StepTracker();
    tracker.observe(10);
    tracker.observe(20);
    const res = buildStatusResponse(baseInput({ stepTrackers: { parse: tracker } }));
    expect(res.stepDurations.parse).toEqual({ avg: 15, p50: 20, p99: 20, count: 2 });
  });

  it('ordena erros por tempo decrescente', () => {
    const recentErrors = [
      { time: '2024-01-01T00:00:00.000Z', message: 'old', count: 1 },
      { time: '2024-01-02T00:00:00.000Z', message: 'new', count: 1 },
    ];
    const res = buildStatusResponse(baseInput({ recentErrors }));
    expect(res.errors[0]!.message).toBe('new');
    expect(res.errors[1]!.message).toBe('old');
  });

  it('override de uptime via formatUptimeFn injetado', () => {
    const res = buildStatusResponse(baseInput({ formatUptimeFn: () => 'CUSTOM' }));
    expect(res.uptime).toBe('CUSTOM');
  });

  it('statusOverrides adiciona campos extras (service padrão prevalece)', () => {
    const res = buildStatusResponse(
      baseInput({ statusOverrides: { service: 'overridden', extra: 'x' } }),
    );
    // service é definido APÓS o spread, então o padrão prevalece
    expect(res.service).toBe('ingestor');
    expect((res as Record<string, unknown>).extra).toBe('x');
  });

  it('campos padrão vencem override de mesma chave (queueSize/dlqCount)', () => {
    const res = buildStatusResponse(
      baseInput({
        dlqCount: 5,
        queueSize: 8,
        statusOverrides: { dlqCount: 999, queueSize: 999 },
      }),
    );
    expect(res.dlqCount).toBe(5);
    expect(res.queueSize).toBe(8);
  });
});

describe('authenticateMetricsRequest', () => {
  it('sem API key configurada → aceita qualquer requisição', () => {
    expect(authenticateMetricsRequest('', '', '')).toBe(true);
    expect(authenticateMetricsRequest('', 'Bearer xyz', 'abc')).toBe(true);
  });

  it('aceita Bearer <key>', () => {
    expect(authenticateMetricsRequest('secret', 'Bearer secret', '')).toBe(true);
  });

  it('aceita x-api-key igual', () => {
    expect(authenticateMetricsRequest('secret', '', 'secret')).toBe(true);
  });

  it('rejeita Bearer errado', () => {
    expect(authenticateMetricsRequest('secret', 'Bearer wrong', '')).toBe(false);
  });

  it('rejeita x-api-key errado', () => {
    expect(authenticateMetricsRequest('secret', '', 'wrong')).toBe(false);
  });

  it('rejeita quando ambos ausentes e key configurada', () => {
    expect(authenticateMetricsRequest('secret', '', '')).toBe(false);
  });
});
