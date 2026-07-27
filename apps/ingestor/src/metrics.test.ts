/**
 * Testes do módulo de métricas do Ingestor.
 *
 * O objeto `steps` é PURO (StepTrackers instanciados no topo do módulo).
 * `initMetrics` depende de registerStepTrackers/createCounter (I/O do
 * metrics-server) — não testável sem hooks de lifecycle. Testamos apenas
 * a estrutura de `steps` e a função `initMetrics` tem chamada coberta
 * indiretamente pelo caller.
 */
import { describe, expect, it } from 'bun:test';
import { steps } from './metrics.ts';

describe('steps', () => {
  it('tem as chaves esperadas', () => {
    const keys = Object.keys(steps).sort();
    expect(keys).toEqual([
      'blacklist',
      'dedup',
      'extract',
      'fanOut',
      'imageFetch',
      'total',
      'whitelist',
    ]);
  });

  it('cada step é um StepTracker (tem observe/snapshot)', () => {
    for (const key of Object.keys(steps)) {
      const step = steps[key as keyof typeof steps];
      expect(typeof step.observe).toBe('function');
      expect(typeof step.snapshot).toBe('function');
    }
  });
});
