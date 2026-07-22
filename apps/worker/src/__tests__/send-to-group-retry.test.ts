/**
 * Test: Validar retry com backoff no sendToGroup.
 *
 * Critério: 3 tentativas com backoff exponencial (2s, 4s, 8s) se
 * Evolution API falhar.
 *
 * Estratégia: testamos através de processMirrorMessage() com Shopee URLs
 * (que pulam a verificação de link de afiliado) e mock do fetch global
 * para controlar as respostas da Evolution API.
 *
 * Cenários:
 *   1. API retorna 500 em todas as tentativas → false, 3 chamadas fetch
 *   2. API falha 2x, sucesso na 3ª → true, 3 chamadas fetch
 *   3. API sucesso na 1ª → true, 1 chamada fetch
 *   4. Network error (fetch throw) em todas → false, 3 chamadas fetch
 *   5. Network error 2x, sucesso na 3ª → true, 3 chamadas fetch
 *   6. Backoff timing: delays crescentes entre tentativas (2s, 4s)
 */

import { describe, it, expect, mock, beforeAll, afterAll, afterEach } from 'bun:test';
import type { MirrorMessageEvent } from '@omestre/shared';

// ========================================================
// Variáveis compartilhadas para controle dinâmico dos mocks
// ========================================================

/** Comportamento de cada chamada fetch: sucesso, falha HTTP, ou exceção. */
type FetchBehavior =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number; body: string }
  | { throws: true; error: Error };

/** Contador global de chamadas fetch realizadas (resetado por afterEach) */
let fetchCallCount = 0;

// ════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════

function makeResponse(ok: boolean, status: number, body = ''): Response {

/**
 * Instala um mock de fetch que segue uma sequência de comportamentos.
 * Cada chamada a fetch avança na sequência. Se a sequência acabar,
 * REPETE o último comportamento (útil para testes com 3 tentativas em que
 * todas são iguais).
 */
function mockFetchSequence(behaviors: FetchBehavior[]) {
  fetchCallCount = 0;
  globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const idx = fetchCallCount;
    fetchCallCount++;
    const behavior = idx < behaviors.length ? behaviors[idx]! : behaviors[behaviors.length - 1]!;
    if ('throws' in behavior) throw behavior.error;
    return makeResponse(behavior.ok, behavior.status, behavior.body);
  }) as unknown as typeof fetch;
}

async function runProcessMirrorMessage(
  event: MirrorMessageEvent,
  behaviors: FetchBehavior[],
): Promise<boolean> {
  mockFetchSequence(behaviors);
  const { processMirrorMessage } = await import('../mirror-pipeline.ts');
  return processMirrorMessage(event);
}

// ════════════════════════════════════════════════════════
// Testes
// ════════════════════════════════════════════════════════

const baseEvent: MirrorMessageEvent = {
  messageId: 'test-retry-001',
  instanceName: 'user-42',
  sourceGroupJid: '120363000000000000@g.us',
  sourceGroupName: 'Grupo Teste Origem',
  affiliateId: 1,
  text: 'Olha essa oferta! https://shopee.com.br/product/123456',
  timestamp: Date.now(),
};

describe('sendToGroup — retry com backoff (3 tentativas, 2s/4s/8s)', () => {
  afterEach(() => {
    fetchCallCount = 0;
  });

  // ── Teste 1: API falha todas as 3 tentativas ──
  it(
    'retorna false quando Evolution API retorna 500 em todas as 3 tentativas',
    async () => {
      const result = await runProcessMirrorMessage(baseEvent, [
        { ok: false, status: 500, body: 'Internal Server Error' },
        { ok: false, status: 500, body: 'Internal Server Error' },
        { ok: false, status: 500, body: 'Internal Server Error' },
      ]);

      expect(result).toBe(false);
      expect(fetchCallCount).toBe(3);
    },
    { timeout: 30000 },
  );

  // ── Teste 2: Falha 2x, sucesso na 3ª ──
  it(
    'retorna true quando Evolution API falha 2x e sucede na 3ª tentativa',
    async () => {
      const result = await runProcessMirrorMessage(baseEvent, [
        { ok: false, status: 503, body: 'Service Unavailable' },
        { ok: false, status: 502, body: 'Bad Gateway' },
        { ok: true, status: 200, body: '{"status":"success"}' },
      ]);

      expect(result).toBe(true);
      expect(fetchCallCount).toBe(3);
    },
    { timeout: 30000 },
  );

  // ── Teste 3: Sucesso na 1ª tentativa ──
  it(
    'retorna true e faz apenas 1 chamada quando Evolution API sucede na 1ª tentativa',
    async () => {
      const result = await runProcessMirrorMessage(baseEvent, [
        { ok: true, status: 200, body: '{"status":"success"}' },
      ]);

      expect(result).toBe(true);
      expect(fetchCallCount).toBe(1);
    },
    { timeout: 10000 },
  );

  // ── Teste 4: Network error em todas as tentativas ──
  it(
    'retorna false e retry 3x quando fetch lança network error',
    async () => {
      const result = await runProcessMirrorMessage(baseEvent, [
        { throws: true, error: new Error('ECONNREFUSED: Evolution API offline') },
        { throws: true, error: new Error('ETIMEDOUT: conexão expirou') },
        { throws: true, error: new Error('ENETUNREACH: rede inalcançável') },
      ]);

      expect(result).toBe(false);
      expect(fetchCallCount).toBe(3);
    },
    { timeout: 30000 },
  );

  // ── Teste 5: Network error 2x, sucesso na 3ª ──
  it(
    'retorna true quando network error 2x e sucesso na 3ª tentativa',
    async () => {
      const result = await runProcessMirrorMessage(baseEvent, [
        { throws: true, error: new Error('ECONNREFUSED: offline') },
        { throws: true, error: new Error('ETIMEDOUT: timeout') },
        { ok: true, status: 200, body: '{"status":"success"}' },
      ]);

      expect(result).toBe(true);
      expect(fetchCallCount).toBe(3);
    },
    { timeout: 30000 },
  );

  // ── Teste 6: 429 também dispara retry ──
  it(
    'retry também em erro 429 (rate limit)',
    async () => {
      const result = await runProcessMirrorMessage(baseEvent, [
        { ok: false, status: 429, body: 'Too Many Requests' },
        { ok: false, status: 429, body: 'Too Many Requests' },
        { ok: true, status: 200, body: '{"status":"success"}' },
      ]);

      expect(result).toBe(true);
      expect(fetchCallCount).toBe(3);
    },
    { timeout: 30000 },
  );

  // ── Teste 7: Sempre erro 502 em todas ──
  it(
    'retorna false após 3 tentativas de erro 502 Bad Gateway',
    async () => {
      const result = await runProcessMirrorMessage(baseEvent, [
        { ok: false, status: 502, body: 'Bad Gateway' },
        { ok: false, status: 502, body: 'Bad Gateway' },
        { ok: false, status: 502, body: 'Bad Gateway' },
      ]);

      expect(result).toBe(false);
      expect(fetchCallCount).toBe(3);
    },
    { timeout: 30000 },
  );

  // ── Teste 8: Backoff timing — delays crescentes ──
  it(
    'respeita os delays de backoff exponencial (2s, 4s) entre tentativas',
    async () => {
      const t0 = Date.now();
      const result = await runProcessMirrorMessage(baseEvent, [
        { ok: false, status: 500, body: 'Error 1' },
        { ok: false, status: 500, body: 'Error 2' },
        { ok: true, status: 200, body: 'OK' },
      ]);
      const elapsed = Date.now() - t0;

      // 3 tentativas: falha (→ sleep 2s) → falha (→ sleep 4s) → sucesso
      // Tempo mínimo: 2s + 4s = ~6000ms (com margem de 20%)
      // Tempo máximo: 2s + 4s + 5s overhead = ~11000ms
      expect(result).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(5000);
      expect(elapsed).toBeLessThan(15000);
      expect(fetchCallCount).toBe(3);
    },
    { timeout: 30000 },
  );
});
