/**
 * Testes do módulo de métricas Prometheus do worker.
 *
 * Cobertura:
 *   1. Contadores simples
 *   2. Contadores com labels
 *   3. Histogramas com buckets
 *   4. Formato Prometheus de saída
 *   5. Registro de métricas padrão (registerDefaultMetrics)
 *   6. Reset de estado entre testes
 *   7. Tracked errors e getStatusResponse
 *   8. Servidor HTTP (/metrics, /health, /status)
 *   9. Contrato de chamadas do pipeline
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach } from 'bun:test';

// ─── Singleton do módulo de métricas + reset entre testes ─────────────

let m: typeof import('../metrics.ts');

beforeAll(async () => {
  m = await import('../metrics.ts');
});

beforeEach(() => {
  m.resetMetrics();
});

afterAll(() => {
  m.stopMetricsServer();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONTADORES SIMPLES
// ═══════════════════════════════════════════════════════════════════════════

describe('Contadores Simples (sem labels)', () => {
  test('cria e incrementa contador', () => {
    m.createCounter('test_total', 'Test counter');
    m.incrementCounter('test_total');
    m.incrementCounter('test_total');
    m.incrementCounter('test_total');

    const output = m.getMetrics();
    expect(output).toContain('# HELP test_total Test counter');
    expect(output).toContain('# TYPE test_total counter');
    expect(output).toContain('test_total 3');
  });

  test('incrementar contador inexistente não lança erro', () => {
    expect(() => m.incrementCounter('nao_existe')).not.toThrow();
  });

  test('createCounter é idempotente', () => {
    m.createCounter('dup_total', 'First');
    m.createCounter('dup_total', 'Second'); // should be ignored
    m.incrementCounter('dup_total');

    const output = m.getMetrics();
    expect(output).toContain('# HELP dup_total First');
    expect(output).not.toContain('Second');
    expect(output).toContain('dup_total 1');
  });

  test('múltiplos contadores sem labels', () => {
    m.createCounter('a_total', 'Counter A');
    m.createCounter('b_total', 'Counter B');
    m.incrementCounter('a_total');
    m.incrementCounter('a_total');
    m.incrementCounter('b_total');

    const output = m.getMetrics();
    expect(output).toContain('a_total 2');
    expect(output).toContain('b_total 1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CONTADORES COM LABELS
// ═══════════════════════════════════════════════════════════════════════════

describe('Contadores com Labels', () => {
  test('cria e incrementa com uma label', () => {
    m.createCounter('test_by_reason', 'Test with reason', ['reason']);

    m.incrementCounter('test_by_reason', { reason: 'no_url' });
    m.incrementCounter('test_by_reason', { reason: 'blacklist' });
    m.incrementCounter('test_by_reason', { reason: 'no_url' });

    const output = m.getMetrics();
    expect(output).toContain('test_by_reason{reason="no_url"} 2');
    expect(output).toContain('test_by_reason{reason="blacklist"} 1');
  });

  test('incrementa com múltiplas labels', () => {
    m.createCounter('test_failures', 'Failures', ['type', 'marketplace']);

    m.incrementCounter('test_failures', { type: 'send_failed', marketplace: 'shopee' });
    m.incrementCounter('test_failures', { type: 'conversion_failed', marketplace: 'mercadolivre' });
    m.incrementCounter('test_failures', { type: 'send_failed', marketplace: 'shopee' });

    const output = m.getMetrics();
    expect(output).toContain('test_failures{type="send_failed",marketplace="shopee"} 2');
    expect(output).toContain('test_failures{type="conversion_failed",marketplace="mercadolivre"} 1');
  });

  test('escape de caracteres especiais em labels', () => {
    m.createCounter('test_escape', 'Escape test', ['reason']);
    m.incrementCounter('test_escape', { reason: 'msg with "quotes"' });

    const output = m.getMetrics();
    expect(output).toContain('reason="msg with \\"quotes\\""');
  });

  test('contador sem labels usa value global', () => {
    m.createCounter('simple_total', 'Simple');
    m.incrementCounter('simple_total');
    m.incrementCounter('simple_total');

    const output = m.getMetrics();
    expect(output).toContain('simple_total 2');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. HISTOGRAMAS
// ═══════════════════════════════════════════════════════════════════════════

describe('Histogramas', () => {
  test('cria e observa histograma', () => {
    m.createHistogram('test_duration_seconds', 'Test duration', ['op'], [0.1, 0.5, 1]);

    m.observeHistogram('test_duration_seconds', 0.3, { op: 'convert' });

    const output = m.getMetrics();
    expect(output).toContain('# HELP test_duration_seconds Test duration');
    expect(output).toContain('# TYPE test_duration_seconds histogram');
    expect(output).toContain('test_duration_seconds_bucket{op="convert"}{le="0.1"} 0');
    expect(output).toContain('test_duration_seconds_bucket{op="convert"}{le="0.5"} 1');
    expect(output).toContain('test_duration_seconds_bucket{op="convert"}{le="1"} 1');
    expect(output).toContain('test_duration_seconds_bucket{op="convert"}{le="+Inf"} 1');
    expect(output).toContain('test_duration_seconds_count{op="convert"} 1');
    expect(output).toContain('test_duration_seconds_sum{op="convert"} 0.3');
  });

  test('observa com valor acima do maior bucket', () => {
    m.createHistogram('test_huge', 'Huge values', [], [0.1, 0.5, 1]);
    m.observeHistogram('test_huge', 5);

    const output = m.getMetrics();
    expect(output).toContain('test_huge_bucket{le="0.1"} 0');
    expect(output).toContain('test_huge_bucket{le="0.5"} 0');
    expect(output).toContain('test_huge_bucket{le="1"} 0');
    expect(output).toContain('test_huge_bucket{le="+Inf"} 1');
  });

  test('observar histograma inexistente não lança erro', () => {
    expect(() => m.observeHistogram('nao_existe', 0.5)).not.toThrow();
  });

  test('múltiplas observações com labels diferentes', () => {
    m.createHistogram('conv_duration', 'Conversion duration', ['marketplace']);

    m.observeHistogram('conv_duration', 0.3, { marketplace: 'shopee' });
    m.observeHistogram('conv_duration', 1.5, { marketplace: 'mercadolivre' });
    m.observeHistogram('conv_duration', 0.1, { marketplace: 'shopee' });

    const output = m.getMetrics();
    expect(output).toContain('conv_duration_count{marketplace="shopee"} 2');
    expect(output).toContain('conv_duration_sum{marketplace="shopee"} 0.4');
    expect(output).toContain('conv_duration_count{marketplace="mercadolivre"} 1');
    expect(output).toContain('conv_duration_sum{marketplace="mercadolivre"} 1.5');
  });

  test('createHistogram com buckets padrão', () => {
    m.createHistogram('default_buckets', 'Default buckets', []);
    m.observeHistogram('default_buckets', 0.5);

    const output = m.getMetrics();
    expect(output).toContain('{le="0.01"} 0');
    expect(output).toContain('{le="0.05"} 0');
    expect(output).toContain('{le="0.5"} 1');
    expect(output).toContain('{le="10"} 1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. FORMATO PROMETHEUS
// ═══════════════════════════════════════════════════════════════════════════

describe('Formato Prometheus de saída', () => {
  test('saída vazia quando não há métricas (após reset)', () => {
    const output = m.getMetrics();
    // Reset limpa tudo → getMetrics retorna apenas '\n' (join de array vazio)
    expect(output.trim()).toBe('');
  });

  test('cada métrica tem HELP e TYPE', () => {
    m.createCounter('c1_total', 'Counter one');
    m.createCounter('c2_total', 'Counter two');
    m.createHistogram('h1_duration', 'Hist one', []);

    const output = m.getMetrics();
    const lines = output.split('\n').filter(Boolean);

    expect(lines).toContain('# HELP c1_total Counter one');
    expect(lines).toContain('# TYPE c1_total counter');
    expect(lines).toContain('# HELP c2_total Counter two');
    expect(lines).toContain('# TYPE c2_total counter');
    expect(lines).toContain('# HELP h1_duration Hist one');
    expect(lines).toContain('# TYPE h1_duration histogram');
  });

  test('termina com newline', () => {
    m.createCounter('t_total', 'Test');
    const output = m.getMetrics();
    expect(output.endsWith('\n')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. REGISTRO DE MÉTRICAS PADRÃO
// ═══════════════════════════════════════════════════════════════════════════

describe('registerDefaultMetrics', () => {
  test('registra todos os contadores e histogramas necessários', () => {
    m.registerDefaultMetrics();

    const output = m.getMetrics();

    // Contadores obrigatórios do critério de aceitação
    expect(output).toContain('mirror_messages_received_total');
    expect(output).toContain('mirror_messages_converted_total');
    expect(output).toContain('mirror_messages_sent_total');
    expect(output).toContain('mirror_messages_blocked_total');
    expect(output).toContain('mirror_failures_total');
    expect(output).toContain('mirror_deduplicated_total');

    // Contadores auxiliares
    expect(output).toContain('mirror_rate_limited_total');
    expect(output).toContain('mirror_rate_limit_wait_ms_total');

    // Histograma obrigatório
    expect(output).toContain('mirror_conversion_duration_seconds');

    // 6 counters principais + 2 aux counters + 1 histogram = 9 HELP lines
    const helpLines = output.split('\n').filter(l => l.startsWith('# HELP'));
    expect(helpLines.length).toBe(9);
  });

  test('é idempotente', () => {
    m.registerDefaultMetrics();
    m.registerDefaultMetrics(); // segunda chamada deve ser ignorada

    const output = m.getMetrics();
    const helpLines = output.split('\n').filter(l => l.startsWith('# HELP'));
    expect(helpLines.length).toBe(9);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. TRACKED ERRORS E STATUS
// ═══════════════════════════════════════════════════════════════════════════

describe('Tracked Errors e Status', () => {
  test('registra erro e aparece no status', async () => {
    m.trackError('Falha na conversão Shopee: HTTP 500');
    m.trackError('Falha na conversão Shopee: HTTP 500'); // duplicado → count=2

    const status = await m.getStatusResponse() as Record<string, unknown>;
    expect(status.status).toBe('healthy');
    const errors = status.errors as Array<{ message: string; count: number; time: string }>;
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe('Falha na conversão Shopee: HTTP 500');
    expect(errors[0]!.count).toBe(2);
  });

  test('limita a 20 erros tracked', async () => {
    for (let i = 0; i < 25; i++) {
      m.trackError(`Erro #${i}`);
    }
    const status = await m.getStatusResponse() as Record<string, unknown>;
    const errors = (status.errors ?? []) as Array<unknown>;
    expect(errors.length).toBeLessThanOrEqual(20);
  });

  test('status tem campos obrigatórios', async () => {
    m.registerDefaultMetrics();
    const status = await m.getStatusResponse() as Record<string, unknown>;
    const errors = (status.errors ?? []) as Array<unknown>;

    expect(status.service).toBe('mirror-worker-metrics');
    expect(status.status).toBe('healthy');
    expect(status).toHaveProperty('uptimeSeconds');
    expect(status).toHaveProperty('uptime');
    expect(status).toHaveProperty('startTime');
    expect(status).toHaveProperty('counters');
    expect(errors).toBeDefined();
  });

  test('setStatusMeta adiciona dados extras ao status', async () => {
    m.setStatusMeta({ mode: 'mirror' });
    m.setStatusMeta({ queueSize: 42 });

    const status = await m.getStatusResponse() as Record<string, unknown>;
    expect(status.mode).toBe('mirror');
    expect(status.queueSize).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. SERVIDOR HTTP DE MÉTRICAS
// ═══════════════════════════════════════════════════════════════════════════

describe('Servidor HTTP de Métricas', () => {
  // Salva o METRICS_PORT original e seta o de teste
  beforeAll(() => {
    // Para o servidor se ainda estiver rodando de outro teste
    m.stopMetricsServer();
  });

  afterAll(() => {
    m.stopMetricsServer();
  });

  test('inicia servidor e expõe /metrics, /health, /status', async () => {
    // Usa portOverride para evitar conflito com o worker rodando em Docker
    const TEST_PORT = 19096;
    m.registerDefaultMetrics();
    m.startMetricsServer(TEST_PORT);

    // Pequena pausa pro servidor iniciar
    await new Promise(r => setTimeout(r, 300));

    try {
      // Testa /health
      const healthRes = await fetch(`http://localhost:${TEST_PORT}/health`);
      expect(healthRes.status).toBe(200);
      expect(await healthRes.text()).toBe('OK');

      // Testa /metrics
      const metricsRes = await fetch(`http://localhost:${TEST_PORT}/metrics`);
      expect(metricsRes.status).toBe(200);
      const metricsText = await metricsRes.text();
      expect(metricsText).toContain('mirror_messages_received_total');
      expect(metricsRes.headers.get('Content-Type')).toContain('text/plain');

      // Testa /status
      const statusRes = await fetch(`http://localhost:${TEST_PORT}/status`);
      const statusText = await statusRes.text();
      const statusData = JSON.parse(statusText) as Record<string, unknown>;
      expect(statusData.service).toBe('mirror-worker-metrics');
      expect(statusData.status).toBe('healthy');
      expect(statusData).toHaveProperty('mode');
      expect(statusData).toHaveProperty('counters');

      // Testa / (root)
      const rootRes = await fetch(`http://localhost:${TEST_PORT}/`);
      expect(rootRes.status).toBe(200);
      const rootText = await rootRes.text();
      const rootData = JSON.parse(rootText) as Record<string, unknown>;
      const endpoints = rootData.endpoints as Array<string>;
      expect(endpoints).toContain('/metrics');
      expect(endpoints).toContain('/health');

      // Testa 404
      const notFoundRes = await fetch(`http://localhost:${TEST_PORT}/notfound`);
      expect(notFoundRes.status).toBe(404);
    } finally {
      m.stopMetricsServer();
    }
  });

  test('startMetricsServer é idempotente', async () => {
    const port = 19097;
    m.registerDefaultMetrics();

    m.startMetricsServer(port);
    m.startMetricsServer(port); // segunda chamada não deve criar outro server

    await new Promise(r => setTimeout(r, 200));

    try {
      const res = await fetch(`http://localhost:${port}/health`);
      expect(res.status).toBe(200);
    } finally {
      m.stopMetricsServer();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. CONTRATO DE CHAMADAS DO PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

describe('Pipeline Metrics — Contrato de chamadas', () => {
  test('mirror-pipeline.ts contém todas as chamadas de métrica obrigatórias', async () => {
    const source = await Bun.file(
      import.meta.dir + '/../mirror-pipeline.ts'
    ).text();

    const requiredMetrics = [
      { metric: 'mirror_messages_received_total', context: '1a — recebida no início do processMirrorMessage' },
      { metric: 'mirror_messages_converted_total', context: '4 — após conversão bem-sucedida (com label marketplace)' },
      { metric: 'mirror_messages_sent_total', context: '7 — após envio bem-sucedido para cada targetGroup' },
      { metric: 'mirror_messages_blocked_total', context: '1b/2/2b/4b/4c/5 — bloqueios por no_url, blacklist, keywords, conversion_failed, affiliate_link_mismatch, no_target_groups' },
      { metric: 'mirror_failures_total', context: '4/7 — quando conversão ou envio falha (com labels type + marketplace)' },
      { metric: 'mirror_deduplicated_total', context: '3 — quando oferta é duplicada' },
      { metric: 'mirror_conversion_duration_seconds', context: '4 — observeHistogram após cada conversão (com label marketplace)' },
    ];

    for (const { metric, context } of requiredMetrics) {
      const occurrences = (source.match(new RegExp(`\\b${metric}\\b`, 'g')) || []).length;
      expect(occurrences).toBeGreaterThanOrEqual(1);
      expect(source).toContain(metric);
    }
  });

  test('cada tipo de bloqueio incrementa mirror_messages_blocked_total com reason apropriada', async () => {
    const source = await Bun.file(
      import.meta.dir + '/../mirror-pipeline.ts'
    ).text();

    const blockReasons = [
      { reason: 'no_url', line: 'mensagem sem URL de marketplace' },
      { reason: 'blacklist', line: 'mensagem filtrada por blacklist' },
      { reason: 'keywords', line: 'mensagem filtrada por keywords' },
      { reason: 'conversion_failed', line: 'conversão falhou' },
      { reason: 'affiliate_link_mismatch', line: 'link convertido não corresponde ao afiliado' },
      { reason: 'no_target_groups', line: 'nenhum grupo de destino configurado' },
    ];

    for (const { reason } of blockReasons) {
      const pattern = `incrementCounter('mirror_messages_blocked_total', { reason: '${reason}' })`;
      expect(source).toContain(pattern);
    }
  });

  test('chamadas de incrementCounter têm labels corretas', async () => {
    const source = await Bun.file(
      import.meta.dir + '/../mirror-pipeline.ts'
    ).text();

    // Verifica labels de marketplace
    expect(source).toContain("incrementCounter('mirror_messages_converted_total', { marketplace })");
    expect(source).toContain("incrementCounter('mirror_failures_total', { type: 'conversion_failed', marketplace })");

    // Observe histograma
    expect(source).toContain("observeHistogram('mirror_conversion_duration_seconds', conversionDuration, { marketplace })");
  });
});
