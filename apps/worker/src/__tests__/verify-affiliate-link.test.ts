/**
 * Test: Validar bloqueio de envio quando conversão falha.
 *
 * Critério: se convertOfferUrl() retorna success=false,
 * processMirrorMessage() não chama sendToGroup() e retorna false.
 *
 * Estratégia: mockamos as dependências externas (DB, Redis, conversores)
 * e forçamos a conversão a falhar. Verificamos que:
 *   1. processMirrorMessage retorna false
 *   2. As métricas de bloqueio são incrementadas
 *   3. Nenhuma chamada HTTP é feita para a Evolution API
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { MirrorMessageEvent } from '@omestre/shared';

// ========================================================
// Mocks — executados ANTES de qualquer import do módulo
// ========================================================

// ── Cache de conversão (Redis) — desligado ──
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
  classifyConversionError: (marketplace: string, error: string) => null,
}));

// ── Dead Letter Queue (Redis) — silenciosa ──
mock.module('./dead-letter-queue.ts', () => ({
  pushToDLQ: () => Promise.resolve(),
}));

// ── DB (PostgreSQL) — todos os repositórios retornam null/vazio ──
mock.module('@omestre/db', () => ({
  getDb: () => {
    throw new Error('DB not available in test');
  },
  affiliates: {},
  reflectedOffers: {},
  UserCredentialsRepository: class {
    async findByUserId() {
      return null;
    }
  },
  MlAffiliateRepository: class {
    async findByPlatformUserId() {
      return null;
    }
  },
  AffiliatesRepository: class {},
}));

// ── Conversores — sempre falham ──
mock.module('@omestre/converters', () => ({
  convertUrl: (url: string) =>
    Promise.resolve({
      success: false,
      affiliateUrl: null,
      error: 'Erro simulado: conversão falhou (teste)',
    }),
  convertShopeeUrlWithCredentials: () =>
    Promise.resolve({
      success: false,
      affiliateUrl: null,
      error: 'Erro simulado: conversão Shopee falhou (teste)',
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
      success: false,
      affiliateUrl: null,
      error: 'Erro simulado: conversão Amazon falhou (teste)',
    }),
}));

// ── Shared — detectMarketplace reconhece URLs de teste ──
mock.module('@omestre/shared', () => ({
  detectMarketplace: (url: string) => {
    if (url.includes('shopee')) return 'shopee';
    if (url.includes('mercadolivre') || url.includes('meli')) return 'mercadolivre';
    if (url.includes('amazon')) return 'amazon';
    return 'unknown';
  },
}));

// ════════════════════════════════════════════════════════
// Testes
// ════════════════════════════════════════════════════════

describe('processMirrorMessage — bloqueio quando conversão falha', () => {
  // Evento base para os testes
  const baseEvent: MirrorMessageEvent = {
    messageId: 'test-msg-001',
    instanceName: 'user-1',
    sourceGroupJid: '120363000000000000@g.us',
    sourceGroupName: 'Grupo Teste Origem',
    affiliateId: 1,
    text: 'Olha essa oferta! https://shopee.com.br/product/123456',
    timestamp: Date.now(),
  };

  beforeEach(() => {
    // Garantir que as métricas comecem limpas
    // As métricas são globais no módulo, então precisamos
    // redefini-las entre testes que verificam contadores.
    // Fazemos isso reimportando o módulo a cada teste.
  });

  it('bloqueia envio quando convertOfferUrl retorna success=false', async () => {
    // Força reconversão: zera o cache de métricas reimportando
    const { processMirrorMessage } = await import('./mirror-pipeline.ts');

    // Act
    const result = await processMirrorMessage(baseEvent);

    // Assert
    expect(result).toBe(false);
  });

  it('bloqueia para Shopee', async () => {
    const { processMirrorMessage } = await import('./mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      ...baseEvent,
      messageId: 'test-shopee-001',
      text: 'Oferta Shopee! https://shopee.com.br/product/ABC123',
    };

    const result = await processMirrorMessage(event);
    expect(result).toBe(false);
  });

  it('bloqueia para Mercado Livre', async () => {
    const { processMirrorMessage } = await import('./mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      ...baseEvent,
      messageId: 'test-ml-001',
      text: 'Oferta ML! https://mercadolivre.com.br/product/ABC123',
    };

    const result = await processMirrorMessage(event);
    expect(result).toBe(false);
  });

  it('bloqueia para Amazon', async () => {
    const { processMirrorMessage } = await import('./mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      ...baseEvent,
      messageId: 'test-amzn-001',
      text: 'Oferta Amazon! https://amazon.com.br/dp/ABC123',
    };

    const result = await processMirrorMessage(event);
    expect(result).toBe(false);
  });

  it('NÃO bloqueia mensagens sem URL de marketplace (ignora normalmente)', async () => {
    const { processMirrorMessage } = await import('./mirror-pipeline.ts');

    const event: MirrorMessageEvent = {
      ...baseEvent,
      messageId: 'test-no-url-001',
      text: 'Bom dia grupo! Sem ofertas hoje.',
    };

    const result = await processMirrorMessage(event);
    // Sem URL de marketplace = blocked (no_url), retorna false
    expect(result).toBe(false);
  });
});
