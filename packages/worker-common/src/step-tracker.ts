/**
 * StepTracker — Ring buffer para tracking de durações de etapas.
 *
 * Usado por Ingestor e Dispatcher para expor percentis (p50, p99)
 * no endpoint /status de cada processador.
 */
export class StepTracker {
  private buffer: number[] = [];
  private maxSize: number;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  observe(durationMs: number): void {
    this.buffer.push(durationMs);
    if (this.buffer.length > this.maxSize) this.buffer.shift();
  }

  snapshot(): { avg: number; p50: number; p99: number; count: number } {
    if (this.buffer.length === 0) {
      return { avg: 0, p50: 0, p99: 0, count: 0 };
    }
    const sorted = [...this.buffer].sort((a, b) => a - b);
    const n = sorted.length;
    const avg = sorted.reduce((a, b) => a + b, 0) / n;
    const p50 = sorted[Math.floor(n * 0.5)] ?? 0;
    const p99 = sorted[Math.floor(n * 0.99)] ?? sorted[n - 1] ?? 0;
    return { avg, p50, p99, count: n };
  }
}

/**
 * Mede a duração de uma etapa e registra no StepTracker.
 * Retorna o resultado da função.
 */
export async function measureStep<T>(
  tracker: StepTracker,
  fn: () => Promise<T> | T,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    tracker.observe(performance.now() - start);
  }
}

/**
 * Mede a duração síncrona de uma etapa e registra no StepTracker.
 */
export function measureStepSync<T>(
  tracker: StepTracker,
  fn: () => T,
): T {
  const start = performance.now();
  try {
    return fn();
  } finally {
    tracker.observe(performance.now() - start);
  }
}