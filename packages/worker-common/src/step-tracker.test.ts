/**
 * Testes do StepTracker — lógica pura de ring buffer + percentis.
 *
 * StepTracker é usado por Ingestor e Dispatcher para expor p50/p99
 * no endpoint /status de cada processador.
 */
import { describe, expect, it } from 'bun:test';
import { StepTracker, measureStep, measureStepSync } from './step-tracker.ts';

describe('StepTracker', () => {
  describe('snapshot() em buffer vazio', () => {
    it('retorna zeros sem falhar', () => {
      const tracker = new StepTracker();
      const snap = tracker.snapshot();
      expect(snap.avg).toBe(0);
      expect(snap.p50).toBe(0);
      expect(snap.p99).toBe(0);
      expect(snap.count).toBe(0);
    });
  });

  describe('observe() + snapshot()', () => {
    it('conta corretamente após 1 observação', () => {
      const tracker = new StepTracker();
      tracker.observe(100);
      const snap = tracker.snapshot();
      expect(snap.count).toBe(1);
      expect(snap.avg).toBe(100);
      expect(snap.p50).toBe(100);
      expect(snap.p99).toBe(100);
    });

    it('calcula avg sobre múltiplas observações', () => {
      const tracker = new StepTracker();
      [10, 20, 30, 40, 50].forEach((v) => tracker.observe(v));
      const snap = tracker.snapshot();
      expect(snap.count).toBe(5);
      expect(snap.avg).toBe(30);
    });

    it('calcula p50 como mediana dos valores', () => {
      const tracker = new StepTracker();
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((v) => tracker.observe(v));
      const snap = tracker.snapshot();
      // floor(10 * 0.5) = 5 → sorted[5] = 6
      expect(snap.p50).toBe(6);
    });

    it('calcula p99 perto do topo da distribuição', () => {
      const tracker = new StepTracker();
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      values.forEach((v) => tracker.observe(v));
      const snap = tracker.snapshot();
      // floor(100 * 0.99) = 99 → sorted[99] = 100
      expect(snap.p99).toBe(100);
    });

    it('p99 não estoura quando o buffer é menor que 100', () => {
      const tracker = new StepTracker();
      [50, 60, 70].forEach((v) => tracker.observe(v));
      const snap = tracker.snapshot();
      // floor(3 * 0.99) = 2 → sorted[2] = 70
      expect(snap.p99).toBe(70);
    });

    it('mantém ordenação estável independente da ordem de inserção', () => {
      const tracker = new StepTracker();
      [50, 10, 80, 30, 20].forEach((v) => tracker.observe(v));
      const snap = tracker.snapshot();
      // sorted: [10, 20, 30, 50, 80] → p50 = sorted[floor(5*0.5)] = sorted[2] = 30
      expect(snap.p50).toBe(30);
      // p99 = sorted[floor(5*0.99)] = sorted[4] = 80
      expect(snap.p99).toBe(80);
      expect(snap.avg).toBe(38);
    });
  });

  describe('ring buffer (maxSize)', () => {
    it('respeita maxSize descartando observações mais antigas', () => {
      const tracker = new StepTracker(3);
      [1, 2, 3, 4, 5].forEach((v) => tracker.observe(v));
      const snap = tracker.snapshot();
      // últimas 3: [3, 4, 5] → avg = 4, p50 = 4
      expect(snap.count).toBe(3);
      expect(snap.avg).toBe(4);
      expect(snap.p50).toBe(4);
      expect(snap.p99).toBe(5);
    });

    it('usa maxSize padrão de 1000 quando não informado', () => {
      const tracker = new StepTracker();
      // insere 1500 valores
      for (let i = 0; i < 1500; i++) tracker.observe(i);
      const snap = tracker.snapshot();
      expect(snap.count).toBe(1000);
    });

    it('aceita maxSize customizado via constructor', () => {
      const tracker = new StepTracker(50);
      for (let i = 0; i < 100; i++) tracker.observe(i);
      const snap = tracker.snapshot();
      expect(snap.count).toBe(50);
    });
  });

  describe('measureStep (async)', () => {
    it('retorna o resultado da função executada', async () => {
      const tracker = new StepTracker();
      const result = await measureStep(tracker, async () => 42);
      expect(result).toBe(42);
    });

    it('registra uma observação mesmo quando a função lança', async () => {
      const tracker = new StepTracker();
      await expect(
        measureStep(tracker, async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      const snap = tracker.snapshot();
      expect(snap.count).toBe(1);
    });

    it('mede funções síncronas (Promise.resolve)', async () => {
      const tracker = new StepTracker();
      const result = await measureStep(tracker, () => 'sync-value');
      expect(result).toBe('sync-value');
      expect(tracker.snapshot().count).toBe(1);
    });
  });

  describe('measureStepSync (sync)', () => {
    it('retorna o resultado da função executada', () => {
      const tracker = new StepTracker();
      const result = measureStepSync(tracker, () => 'ok');
      expect(result).toBe('ok');
      expect(tracker.snapshot().count).toBe(1);
    });

    it('registra observação mesmo quando a função lança', () => {
      const tracker = new StepTracker();
      expect(() =>
        measureStepSync(tracker, () => {
          throw new Error('sync boom');
        }),
      ).toThrow('sync boom');
      expect(tracker.snapshot().count).toBe(1);
    });
  });
});
