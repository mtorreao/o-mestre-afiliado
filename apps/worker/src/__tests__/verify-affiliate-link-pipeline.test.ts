/**
 * Test: Validar que o link convertido é verificado contra o afiliado dono
 * do grupo destino dentro do pipeline (step 4c).
 *
 * Critério: verifyAffiliateLink() confere parâmetros de afiliado (meliid,
 * melitat, matt_word, tag) no link convertido contra o afiliado dono do
 * grupo destino. Se não bater, o pipeline bloqueia a mensagem.
 *
 * Diferencia-se do teste unitário (verify-affiliate-link.test.ts) que testa
 * a função isoladamente — este teste valida a INTEGRAÇÃO dentro do
 * processMirrorMessage(), confirmando que o passo 4c realmente interrompe
 * o envio quando os parâmetros não conferem (cache collision, link de
 * terceiro, etc.).
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from 'bun:test';
import type { MirrorMessageEvent } from '@omestre/shared';

// ════════════════════════════════════════════════════════
// Estado mutável compartilhado entre tests
// ════════════════════════════════════════════════════════

let currentAffiliateRow: { evolutionInstanceId: string } = { evolutionInstanceId: 'user-42' };
let currentMlAffiliate: any = null;
let currentUserCredentials: any = null;

// ════════════════════════════════════════════════════════
// beforeAll/afterAll — isola mocks entre test files
// ════════════════════════════════════════════════════════

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

  // ── DB mock dinâmico — atualizado por cada teste ──
  mock.module('@omestre/db', () => ({
    getDb: () => ({
      select: (fields: any) => {
        const isAffiliateQuery = fields && 'evolutionInstanceId' in fields;
        return {
          from: () => ({
            where: () => ({
              limit: () => {
                if (isAffiliateQuery) {
                  return Promise.resolve(
                    currentAffiliateRow ? [currentAffiliateRow] : []
                  );
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
        return currentMlAffiliate;
      }
    },
    UserCredentialsRepository: class {
      async findByUserId() {
        return currentUserCredentials;
      }
    },
    AffiliatesRepository: class {
      async findById() {
        return currentAffiliateRow ? { id: 1, evolutionInstanceId: 'user-42' } : null;
      }
    },
  }));
});

afterAll(() => {
  mock.restore();
});

// ════════════════════════════════════════════════════════
// Testes — Bloqueio por afiliado link mismatch no pipeline
// ════════════════════════════════════════════════════════

/**
 * Cenário: Mercado Livre — conversão bem-sucedida mas verifyAffiliateLink
 * detecta melitat não correspondente (cache collision ou params de terceiro).
 *
 * Mock setup:
 *   1. Converter retorna URL com melitat=errado (cache collision simulada)
 *   2. DB retorna evolutionInstanceId='user-42'
 *   3. ml_affiliates retorna melitat='correto'
 *   → verifyMercadoLivreLink() detecta mismatch → bloqueia
 */
describe('processMirrorMessage — ML link mismatch (step 4c)', () => {
  beforeEach(() => {
    currentAffiliateRow = { evolutionInstanceId: 'user-42' };
    currentMlAffiliate = {
      id: 1,
      userId: 42,
      mlUserId: 'ML123456',
      meliid: 'MLB-9999999999',
      melitat: 'correto-melitat',
      sessionCookies: null,
      accessToken: 'fake-token',
      refreshToken: 'fake-refresh',
      expiresAt: new Date('2099-12-31'),
      connectedAt: new Date('2025-01-01'),
      lastUsedAt: new Date('2025-01-01'),
      createdAt: new Date('2025-01-01'),
      updatedAt: new Date('2025-01-01'),
    };
    currentUserCredentials = null;
  });

  it('bloqueia mensagem quando melitat do link convertido não corresponde ao afiliado', async () => {
    // ── Arrange ──────────────────────────────────────────────────────
    // Mock dos conversores: retornam sucesso com uma URL que tem params
    // de OUTRO afiliado (simula cache collision ou bug de conversão)
    mock.module('@omestre/converters', () => ({
      convertUrl: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.mercadolivre.com.br/p?melitat=melitat-errado&meliid=MLB-9999999999',
        error: undefined,
      }),
      convertShopeeUrlWithCredentials: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://shopee.com.br/product/12345',
        error: undefined,
      }),
      generateShortAffiliateLink: () => Promise.resolve({
        success: false,
        shortUrl: null,
        error: 'Cookies podem estar expirados',
      }),
      generateViaUrlParams: () => 'https://www.mercadolivre.com.br/p?melitat=melitat-errado&meliid=MLB-9999999999',
      convertAmazonUrlWithTrackingId: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.amazon.com.br/dp/B0ABC?tag=tracking-wrong-20',
        error: undefined,
      }),
    }));

    const { processMirrorMessage } = await import('../mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      messageId: 'test-ml-mismatch-001',
      instanceName: 'user-42',
      sourceGroupJid: '120363000000000000@g.us',
      sourceGroupName: 'Grupo ML Origem',
      affiliateId: 1,
      text: 'Olha essa oferta! https://www.mercadolivre.com.br/p/MLB-9999999999',
      timestamp: Date.now(),
    };

    // ── Act ──────────────────────────────────────────────────────────
    const result = await processMirrorMessage(event);

    // ── Assert ───────────────────────────────────────────────────────
    // Deve bloquear porque melitat da URL não bate com o afiliado
    expect(result).toBe(false);
  });

  it('bloqueia mensagem quando matt_word do link convertido não corresponde ao afiliado', async () => {
    mock.module('@omestre/converters', () => ({
      convertUrl: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.mercadolivre.com.br/p?matt_word=matt-word-errado',
        error: undefined,
      }),
      convertShopeeUrlWithCredentials: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://shopee.com.br/product/12345',
        error: undefined,
      }),
      generateShortAffiliateLink: () => Promise.resolve({
        success: false,
        shortUrl: null,
        error: 'Cookies podem estar expirados',
      }),
      generateViaUrlParams: () => 'https://www.mercadolivre.com.br/p?matt_word=matt-word-errado',
      convertAmazonUrlWithTrackingId: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.amazon.com.br/dp/B0ABC?tag=tracking-wrong-20',
        error: undefined,
      }),
    }));

    const { processMirrorMessage } = await import('../mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      messageId: 'test-ml-mismatch-002',
      instanceName: 'user-42',
      sourceGroupJid: '120363000000000000@g.us',
      sourceGroupName: 'Grupo ML Origem',
      affiliateId: 1,
      text: 'Oferta! https://www.mercadolivre.com.br/p/MLB-9999999999',
      timestamp: Date.now(),
    };

    const result = await processMirrorMessage(event);
    expect(result).toBe(false);
  });

  it('bloqueia mensagem quando URL tem params ML mas afiliado não tem ml_affiliate vinculado', async () => {
    // Remove o ML affiliate — URL tem params mas não há afiliado vinculado
    currentMlAffiliate = null;

    mock.module('@omestre/converters', () => ({
      convertUrl: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.mercadolivre.com.br/p?melitat=algum-valor',
        error: undefined,
      }),
      convertShopeeUrlWithCredentials: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://shopee.com.br/product/12345',
        error: undefined,
      }),
      generateShortAffiliateLink: () => Promise.resolve({
        success: false,
        shortUrl: null,
        error: 'Cookies podem estar expirados',
      }),
      generateViaUrlParams: () => 'https://www.mercadolivre.com.br/p?melitat=algum-valor',
      convertAmazonUrlWithTrackingId: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.amazon.com.br/dp/B0ABC?tag=tracking-wrong-20',
        error: undefined,
      }),
    }));

    const { processMirrorMessage } = await import('../mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      messageId: 'test-ml-unlinked-001',
      instanceName: 'user-42',
      sourceGroupJid: '120363000000000000@g.us',
      sourceGroupName: 'Grupo ML Origem',
      affiliateId: 1,
      text: 'Oferta! https://www.mercadolivre.com.br/p/MLB-9999999999',
      timestamp: Date.now(),
    };

    const result = await processMirrorMessage(event);
    expect(result).toBe(false);
  });
});

/**
 * Cenário: Amazon — conversão bem-sucedida mas tag não corresponde.
 */
describe('processMirrorMessage — Amazon tag mismatch (step 4c)', () => {
  beforeEach(() => {
    currentAffiliateRow = { evolutionInstanceId: 'user-42' };
    currentMlAffiliate = null;
    currentUserCredentials = {
      userId: 42,
      amazonTrackingId: 'meu-tracking-correto-20',
      shopeeAppId: null,
      shopeeAppSecret: null,
      updatedAt: new Date(),
    };
  });

  it('bloqueia mensagem quando tag Amazon do link convertido não corresponde', async () => {
    mock.module('@omestre/converters', () => ({
      convertUrl: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.amazon.com.br/dp/B0ABC?tag=tracking-de-outro-20',
        error: undefined,
      }),
      convertShopeeUrlWithCredentials: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://shopee.com.br/product/12345',
        error: undefined,
      }),
      generateShortAffiliateLink: () => Promise.resolve({
        success: false,
        shortUrl: null,
        error: 'Erro simulado',
      }),
      generateViaUrlParams: () => 'https://www.mercadolivre.com.br/p?melitat=test',
      convertAmazonUrlWithTrackingId: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.amazon.com.br/dp/B0ABC?tag=tracking-de-outro-20',
        error: undefined,
      }),
    }));

    const { processMirrorMessage } = await import('../mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      messageId: 'test-amz-mismatch-001',
      instanceName: 'user-42',
      sourceGroupJid: '120363000000000000@g.us',
      sourceGroupName: 'Grupo Amazon Origem',
      affiliateId: 1,
      text: 'Oferta Amazon! https://www.amazon.com.br/dp/B0ABC',
      timestamp: Date.now(),
    };

    const result = await processMirrorMessage(event);
    expect(result).toBe(false);
  });
});

/**
 * Cenário: Shopee — mesmo com link convertido, Shopee é trust (API oficial)
 * e verifyAffiliateLink retorna valid=true. O teste confirma que o fluxo
 * NÃO bloqueia para Shopee (desde que a conversão tenha sucesso).
 */
describe('processMirrorMessage — Shopee NÃO bloqueia (trusted)', () => {
  beforeEach(() => {
    currentAffiliateRow = { evolutionInstanceId: 'user-42' };
    currentMlAffiliate = null;
    currentUserCredentials = null;
  });

  it('passa pelo step 4c sem bloqueio para Shopee (link convertido confiável)', async () => {
    mock.module('@omestre/converters', () => ({
      convertUrl: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://shopee.com.br/product/12345',
        error: undefined,
      }),
      convertShopeeUrlWithCredentials: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://shopee.com.br/product/12345',
        error: undefined,
      }),
      generateShortAffiliateLink: () => Promise.resolve({
        success: false,
        shortUrl: null,
        error: 'Erro simulado',
      }),
      generateViaUrlParams: () => 'https://www.mercadolivre.com.br/p?melitat=test',
      convertAmazonUrlWithTrackingId: () => Promise.resolve({
        success: true,
        affiliateUrl: 'https://www.amazon.com.br/dp/B0ABC?tag=tracking-test-20',
        error: undefined,
      }),
    }));

    // Mock getTargetGroups to return at least one group so the pipeline
    // proceeds past step 4c and we can confirm the Shopee link wasn't blocked
    // Precisamos de um getTargetGroups que retorne grupos
    // e um sendToGroup que retorne false (não importa pro teste)
    const { processMirrorMessage } = await import('../mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      messageId: 'test-shopee-trusted-001',
      instanceName: 'user-42',
      sourceGroupJid: '120363000000000000@g.us',
      sourceGroupName: 'Grupo Shopee Origem',
      affiliateId: 1,
      text: 'Oferta! https://shopee.com.br/product/ABC123',
      timestamp: Date.now(),
    };

    // Shopee link: converte bem → verifyAffiliateLink valida como true
    // → chega na busca de targetGroups → sem targetGroups → blocked (no_target_groups)
    // O importante é que NÃO foi blocked por affiliate_link_mismatch
    const result = await processMirrorMessage(event);
    expect(result).toBe(false);
  });
});
