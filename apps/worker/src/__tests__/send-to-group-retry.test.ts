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
  // Bun requires status in range [200, 599] for ok=false; use 500+ for errors
  return new Response(body, { status, statusText: ok ? 'OK' : 'Error' });
}

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

// targetGroups usado pelo mock do @omestre/db
const targetGroups = [{ jid: '120363000000000001@g.us', name: 'Grupo Teste Destino' }];

describe('sendToGroup — retry com backoff (3 tentativas, 2s/4s/8s)', () => {
  // ✅ beforeAll/afterAll isolam mocks entre test files (mock.module é global)
  beforeAll(() => {
    mock.restore();
    // ── Cache de conversão (Redis) — sempre miss ──
    mock.module('./conversion-cache.ts', () => ({
      getCachedConversion: () => Promise.resolve(null),
      setCachedConversion: () => Promise.resolve(),
    }));

    // ── Rate limiter (Redis) — sempre concede slot ──
    mock.module('./rate-limiter.ts', () => ({
      tryAcquireSlot: () => Promise.resolve({ acquired: true, waitMs: 0 }),
      waitForSlot: () => Promise.resolve(true),
    }));

    // ── Notifier (Redis) — silencioso ──
    mock.module('./notifier.ts', () => ({
      processFailure: () => Promise.resolve(),
      classifyConversionError: () => null,
    }));

    // ── Dead Letter Queue (Redis) — silenciosa ──
    mock.module('./dead-letter-queue.ts', () => ({
      pushToDLQ: () => Promise.resolve(),
    }));

    // ── Métricas — sem contadores reais ──
    mock.module('./metrics.ts', () => ({
      incrementCounter: () => {},
      observeHistogram: () => {},
    }));

    // ── Conversores — sempre sucesso com Shopee ──
    mock.module('@omestre/converters', () => ({
      convertUrl: () =>
        Promise.resolve({
          success: true,
          affiliateUrl: 'https://shopee.com.br/product/12345-converted',
          error: undefined,
        }),
      convertShopeeUrlWithCredentials: () =>
        Promise.resolve({
          success: true,
          affiliateUrl: 'https://shopee.com.br/product/12345-converted',
          error: undefined,
        }),
      generateShortAffiliateLink: () =>
        Promise.resolve({
          success: false,
          shortUrl: null,
          error: 'Erro simulado: link curto ML falhou (teste)',
        }),
      generateViaUrlParams: () => 'https://example.com/params',
      convertAmazonUrlWithTrackingId: () =>
        Promise.resolve({
          success: true,
          affiliateUrl: 'https://www.amazon.com.br/dp/B0ABC?tag=tracking-test-20',
          error: undefined,
        }),
    }));

    // ── Shared — detectMarketplace + constantes ──
    mock.module('@omestre/shared', () => ({
      detectMarketplace: (url: string) => {
        if (url.includes('shopee')) return 'shopee';
        if (url.includes('mercadolivre') || url.includes('meli')) return 'mercadolivre';
        if (url.includes('amazon')) return 'amazon';
        return 'unknown';
      },
      MIRROR_CONVERSION_CACHE_PREFIX: 'mirror:conversion:',
      MIRROR_CONVERSION_CACHE_TTL: 3600,
      MIRROR_MESSAGE_CHANNEL: 'omestre:mirror:message',
      MIRROR_STREAM: 'omestre:mirror:stream',
      MIRROR_CONSUMER_GROUP: 'omestre:mirror:workers',
      MIRROR_DLQ_LIST: 'mirror:dlq:entries',
      MIRROR_DLQ_INDEX: 'mirror:dlq:index',
      MIRROR_DLQ_TTL: 7 * 24 * 3600,
      MARKETPLACE_DOMAINS: {
        shopee: [/shopee/, /go\.promozone\.ai\/shopee/],
        mercadolivre: [/mercadolivre/, /meli/, /go\.promozone\.ai\/mercadolivre/],
        amazon: [/amazon/, /amzn/, /go\.promozone\.ai\/amazon/],
        unknown: [],
      },
      MirrorMessageEvent: class {},
      MirrorDLQEntry: class {},
    }));

    // ── DB (PostgreSQL) — mock dinâmico com targetGroups ──
    mock.module('@omestre/db', () => ({
      getDb: () => ({
        select: (fields: any) => {
          const isEvolutionId = fields && 'evolutionInstanceId' in fields;
          const isTargetGroups = fields && 'targetGroups' in fields;
          const isFilters = fields && 'filters' in fields;
          const isMessageTemplate = fields && 'messageTemplate' in fields;

          return {
            from: () => ({
              where: () => ({
                limit: () => {
                  if (isEvolutionId) {
                    return Promise.resolve([{ evolutionInstanceId: 'user-42' }]);
                  }
                  if (isTargetGroups) {
                    return Promise.resolve([{ targetGroups }]);
                  }
                  if (isFilters) {
                    return Promise.resolve([]);
                  }
                  if (isMessageTemplate) {
                    return Promise.resolve([]);
                  }
                  return Promise.resolve([]);
                },
              }),
            }),
          };
        },
        insert: () => ({
          values: () => Promise.resolve(),
        }),
      }),
      affiliates: {
        id: 'id',
        evolutionInstanceId: 'evolutionInstanceId',
        targetGroups: 'targetGroups',
        filters: 'filters',
        messageTemplate: 'messageTemplate',
      },
      and: (...args: any[]) => args,
      eq: (a: any, b: any) => ({ a, b }),
      gte: (a: any, b: any) => ({ a, b }),
      reflectedOffers: {
        id: 'id',
        affiliateId: 'affiliateId',
        originalLink: 'originalLink',
        reflectedAt: 'reflectedAt',
      },
      MlAffiliateRepository: class {
        async findByPlatformUserId() {
          return null;
        }
      },
      UserCredentialsRepository: class {
        async findByUserId() {
          return null;
        }
      },
      AffiliatesRepository: class {
        async findById() {
          return { id: 1, evolutionInstanceId: 'user-42' };
        }
      },
    }));
  });

  afterAll(() => {
    mock.restore();
  });

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
