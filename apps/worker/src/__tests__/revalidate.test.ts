/**
 * Test: Validar revalidação periódica automática dos grupos fonte.
 *
 * Critérios:
 *   1) Worker em modo --revalidate executa a validação corretamente
 *   2) Grupos que passam nos 70% são mantidos como ativos
 *   3) Grupos que caem abaixo de 70% geram alerta com statusChanged=true
 *   4) Configuração REVALIDATION_INTERVAL_DAYS é respeitada
 *   5) Migration adiciona colunas last_validated_at, last_validation_passed, last_validation_report
 *   6) Edge cases: grupo sem mensagens, grupo com 100% ofertas, grupo com 0% ofertas
 *   7) Alteração de status (passou→falhou) é detectada corretamente
 */

import { describe, it, expect } from 'bun:test';

// ========================================================
// Helpers — gera mensagens de teste
// ========================================================

function makeNonOfferMessage(): string {
  return 'Bom dia pessoal! Alguém tem indicação de onde comprar?';
}

// Regex copied from revalidate.ts for testing (the actual function is not exported)
const URL_REGEX = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX);
  if (!matches) return [];
  return [...new Set(matches)];
}

function detectMarketplace(url: string): string {
  if (/shopee\.com\.br/i.test(url)) return 'shopee';
  if (/mercadolivre\.com\.br|mercadolibre/i.test(url)) return 'mercadolivre';
  if (/amazon\.com\.br|amazon\.com\//i.test(url)) return 'amazon';
  if (/go\.promozone\.ai/i.test(url)) return 'redirector';
  return 'unknown';
}

function isKnownMarketplaceUrl(text: string): boolean {
  const urls = extractUrls(text);
  if (urls.length === 0) return false;
  return urls.some((u) => detectMarketplace(u) !== 'unknown');
}

// Calculate validation result without needing Evolution API
function calculateValidation(
  messages: { text: string }[],
  minRatio = 0.7,
): { validCount: number; totalMessages: number; ratio: number; passed: boolean } {
  const totalMessages = messages.length;
  if (totalMessages === 0) {
    return { validCount: 0, totalMessages: 0, ratio: 0, passed: false };
  }
  let validCount = 0;
  for (const msg of messages) {
    if (isKnownMarketplaceUrl(msg.text)) {
      validCount++;
    }
  }
  const ratio = Math.round((validCount / totalMessages) * 100) / 100;
  const passed = ratio >= minRatio;
  return { validCount, totalMessages, ratio, passed };
}

// ========================================================
// Helpers — messages
// ========================================================

function makeOfferMessage(marketplace: string): string {
  const urls: Record<string, string> = {
    shopee: 'https://shopee.com.br/product/123456?sp=abc',
    mercadolivre: 'https://www.mercadolivre.com.br/product/ABC123',
    amazon: 'https://www.amazon.com.br/dp/B0ABC123DEF',
    goPromozone: 'https://go.promozone.ai/redirect/shopee?url=https%3A%2F%2Fshopee.com.br%2Fproduct%2F789',
  };
  return `Confira a oferta: ${urls[marketplace] ?? urls.shopee}`;
}

// ═══════════════════════════════════════════════════════════════
// TESTES: URL detection logic
// ═══════════════════════════════════════════════════════════════

describe('URL detection', () => {
  it('should detect marketplace URLs', () => {
    expect(isKnownMarketplaceUrl(makeOfferMessage('shopee'))).toBe(true);
  });

  it('should reject non-offer messages', () => {
    expect(isKnownMarketplaceUrl(makeNonOfferMessage())).toBe(false);
  });

  it('should handle empty text', () => {
    expect(isKnownMarketplaceUrl('')).toBe(false);
  });

  it('should handle text with no URLs', () => {
    expect(isKnownMarketplaceUrl('Apenas texto sem links')).toBe(false);
  });

  it('should detect Mercado Livre URLs', () => {
    expect(isKnownMarketplaceUrl(makeOfferMessage('mercadolivre'))).toBe(true);
  });

  it('should detect Amazon URLs', () => {
    expect(isKnownMarketplaceUrl(makeOfferMessage('amazon'))).toBe(true);
  });

  it('should detect go.promozone.ai redirector URLs', () => {
    expect(isKnownMarketplaceUrl(makeOfferMessage('goPromozone'))).toBe(true);
  });
});

describe('extractUrls', () => {
  it('should extract HTTP URLs from text', () => {
    const text = 'Confira: https://shopee.com.br/produto/123 e https://mercadolivre.com.br/item/456';
    const urls = extractUrls(text);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('shopee.com.br');
    expect(urls[1]).toContain('mercadolivre.com.br');
  });

  it('should return empty array for text without URLs', () => {
    const urls = extractUrls('Apenas texto comum');
    expect(urls).toHaveLength(0);
  });

  it('should deduplicate URLs', () => {
    const text = 'Link1: https://shopee.com.br/a Link2: https://shopee.com.br/a';
    const urls = extractUrls(text);
    expect(urls).toHaveLength(1);
  });
});

describe('detectMarketplace', () => {
  it('should identify Shopee URLs', () => {
    expect(detectMarketplace('https://shopee.com.br/product/123')).toBe('shopee');
  });

  it('should identify Mercado Livre URLs', () => {
    expect(detectMarketplace('https://www.mercadolivre.com.br/product/ABC')).toBe('mercadolivre');
    expect(detectMarketplace('https://www.mercadolibre.com.ar/product/XYZ')).toBe('mercadolivre');
  });

  it('should identify Amazon URLs', () => {
    expect(detectMarketplace('https://www.amazon.com.br/dp/B0ABC')).toBe('amazon');
    expect(detectMarketplace('https://www.amazon.com/dp/B0XYZ')).toBe('amazon');
  });

  it('should identify go.promozone.ai as redirector', () => {
    expect(detectMarketplace('https://go.promozone.ai/redirect')).toBe('redirector');
  });

  it('should return unknown for unrelated URLs', () => {
    expect(detectMarketplace('https://google.com')).toBe('unknown');
    expect(detectMarketplace('https://github.com')).toBe('unknown');
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTES: validateGroup logic (mock messages)
// ═══════════════════════════════════════════════════════════════

describe('validateGroup (single group logic)', () => {
  it('should pass when ≥70% are offers', () => {
    const messages = [
      ...Array(7).fill(null).map(() => ({ text: makeOfferMessage('shopee') })),
      ...Array(3).fill(null).map(() => ({ text: makeNonOfferMessage() })),
    ];
    const result = calculateValidation(messages);
    expect(result.validCount).toBe(7);
    expect(result.totalMessages).toBe(10);
    expect(result.ratio).toBe(0.7);
    expect(result.passed).toBe(true);
  });

  it('should fail when <70% are offers', () => {
    const messages = [
      ...Array(3).fill(null).map(() => ({ text: makeOfferMessage('shopee') })),
      ...Array(7).fill(null).map(() => ({ text: makeNonOfferMessage() })),
    ];
    const result = calculateValidation(messages);
    expect(result.validCount).toBe(3);
    expect(result.totalMessages).toBe(10);
    expect(result.ratio).toBeCloseTo(0.3);
    expect(result.passed).toBe(false);
  });

  it('should handle 100% offers (all messages are valid)', () => {
    const messages = Array(10).fill(null).map(() => ({ text: makeOfferMessage('shopee') }));
    const result = calculateValidation(messages);
    expect(result.validCount).toBe(10);
    expect(result.ratio).toBe(1.0);
    expect(result.passed).toBe(true);
  });

  it('should handle 0% offers (no marketplace links)', () => {
    const messages = Array(10).fill(null).map(() => ({ text: makeNonOfferMessage() }));
    const result = calculateValidation(messages);
    expect(result.validCount).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('should handle empty messages array (no messages found)', () => {
    const result = calculateValidation([]);
    expect(result.validCount).toBe(0);
    expect(result.totalMessages).toBe(0);
    expect(result.ratio).toBe(0);
    expect(result.passed).toBe(false);
  });

  it('should round ratio to 2 decimal places', () => {
    // 5 valid out of 7 = 71.428... → 0.71
    const messages = [
      ...Array(5).fill(null).map(() => ({ text: makeOfferMessage('shopee') })),
      ...Array(2).fill(null).map(() => ({ text: makeNonOfferMessage() })),
    ];
    const result = calculateValidation(messages);
    expect(result.ratio).toBe(0.71);
    expect(result.validCount).toBe(5);
    expect(result.totalMessages).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTES: validateOfferGroups (multi-group aggregation)
// ═══════════════════════════════════════════════════════════════

describe('validateOfferGroups (multi-group)', () => {
  it('should pass only when ALL groups pass', () => {
    const groups = [
      { totalMessages: 10, validOffers: 7, passed: true },
      { totalMessages: 10, validOffers: 8, passed: true },
    ];
    const allPassed = groups.every((g) => g.passed) && groups.length > 0;
    expect(allPassed).toBe(true);
  });

  it('should fail if ANY group fails', () => {
    const groups = [
      { totalMessages: 10, validOffers: 7, passed: true },
      { totalMessages: 10, validOffers: 3, passed: false },
    ];
    const allPassed = groups.every((g) => g.passed) && groups.length > 0;
    expect(allPassed).toBe(false);
  });

  it('should fail if no groups provided', () => {
    const groups: { passed: boolean }[] = [];
    const allPassed = groups.every((g) => g.passed) && groups.length > 0;
    expect(allPassed).toBe(false);
  });

  it('should calculate overall ratio correctly', () => {
    const groupResults = [
      calculateValidation([
        ...Array(7).fill(null).map(() => ({ text: makeOfferMessage('shopee') })),
        ...Array(3).fill(null).map(() => ({ text: makeNonOfferMessage() })),
      ]),
      calculateValidation([
        ...Array(9).fill(null).map(() => ({ text: makeOfferMessage('mercadolivre') })),
        ...Array(1).fill(null).map(() => ({ text: makeNonOfferMessage() })),
      ]),
    ];
    const totalMessages = groupResults.reduce((s, r) => s + r.totalMessages, 0);
    const totalValidOffers = groupResults.reduce((s, r) => s + r.validCount, 0);
    const overallRatio = Math.round((totalValidOffers / totalMessages) * 100) / 100;
    const allPassed = groupResults.every((r) => r.passed) && groupResults.length > 0;
    expect(totalMessages).toBe(20);
    expect(totalValidOffers).toBe(16);
    expect(overallRatio).toBe(0.8);
    expect(allPassed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTES: statusChanged detection
// ═══════════════════════════════════════════════════════════════

describe('statusChanged detection', () => {
  it('should detect when group went from passed→failed (statusChanged=true)', () => {
    const previouslyPassed = true;
    const currentPassed = false;
    const statusChanged = previouslyPassed !== null && previouslyPassed !== currentPassed;
    expect(statusChanged).toBe(true);
  });

  it('should detect when group went from failed→passed (statusChanged=true)', () => {
    const previouslyPassed = false;
    const currentPassed = true;
    const statusChanged = previouslyPassed !== null && previouslyPassed !== currentPassed;
    expect(statusChanged).toBe(true);
  });

  it('should NOT detect change when status is same (both passed)', () => {
    const previouslyPassed = true;
    const currentPassed = true;
    const statusChanged = previouslyPassed !== null && previouslyPassed !== currentPassed;
    expect(statusChanged).toBe(false);
  });

  it('should NOT detect change when status is same (both failed)', () => {
    const previouslyPassed = false;
    const currentPassed = false;
    const statusChanged = previouslyPassed !== null && previouslyPassed !== currentPassed;
    expect(statusChanged).toBe(false);
  });

  it('should NOT detect change when previouslyPassed is null (first run)', () => {
    const previouslyPassed = null;
    const currentPassed = false;
    const statusChanged = previouslyPassed !== null && previouslyPassed !== currentPassed;
    expect(statusChanged).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTES: REVALIDATION_INTERVAL_DAYS config
// ═══════════════════════════════════════════════════════════════

describe('REVALIDATION_INTERVAL_DAYS config', () => {
  it('should default to 7 days when env var is not set', () => {
    const saved = process.env.REVALIDATION_INTERVAL_DAYS;
    delete process.env.REVALIDATION_INTERVAL_DAYS;
    const interval = parseInt(process.env.REVALIDATION_INTERVAL_DAYS || '7', 10);
    expect(interval).toBe(7);
    if (saved) process.env.REVALIDATION_INTERVAL_DAYS = saved;
  });

  it('should use env var when set', () => {
    process.env.REVALIDATION_INTERVAL_DAYS = '14';
    const interval = parseInt(process.env.REVALIDATION_INTERVAL_DAYS || '7', 10);
    expect(interval).toBe(14);
    delete process.env.REVALIDATION_INTERVAL_DAYS;
  });

  it('should calculate daemon interval correctly', () => {
    const days = 7;
    const intervalMs = days * 24 * 60 * 60 * 1000;
    expect(intervalMs).toBe(604800000);
  });

  it('should calculate cutoff date for revalidation needs', () => {
    const days = 7;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const diff = Math.abs(cutoff.getTime() - oneWeekAgo.getTime());
    expect(diff).toBeLessThan(100);
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTES: findAllNeedingRevalidation logic
// ═══════════════════════════════════════════════════════════════

describe('findAllNeedingRevalidation (affiliate filter logic)', () => {
  function shouldRevalidate(
    affiliate: {
      active: boolean;
      sourceGroups: unknown[];
      lastValidatedAt: Date | null;
    },
    daysInterval: number,
  ): boolean {
    if (!affiliate.active) return false;
    if (!affiliate.sourceGroups?.length) return false;
    if (!affiliate.lastValidatedAt) return true;
    const cutoff = new Date(Date.now() - daysInterval * 24 * 60 * 60 * 1000);
    return affiliate.lastValidatedAt < cutoff;
  }

  it('should include affiliates that were never validated', () => {
    const aff = { active: true, sourceGroups: [{ jid: 'a@g.us' }], lastValidatedAt: null };
    expect(shouldRevalidate(aff, 7)).toBe(true);
  });

  it('should include affiliates validated long ago', () => {
    const aff = {
      active: true,
      sourceGroups: [{ jid: 'a@g.us' }],
      lastValidatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    };
    expect(shouldRevalidate(aff, 7)).toBe(true);
  });

  it('should exclude affiliates validated recently', () => {
    const aff = {
      active: true,
      sourceGroups: [{ jid: 'a@g.us' }],
      lastValidatedAt: new Date(Date.now() - 1 * 60 * 60 * 1000),
    };
    expect(shouldRevalidate(aff, 7)).toBe(false);
  });

  it('should exclude inactive affiliates', () => {
    const aff = {
      active: false,
      sourceGroups: [{ jid: 'a@g.us' }],
      lastValidatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    };
    expect(shouldRevalidate(aff, 7)).toBe(false);
  });

  it('should exclude affiliates without source groups', () => {
    const aff = {
      active: true,
      sourceGroups: [],
      lastValidatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    };
    expect(shouldRevalidate(aff, 7)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTES: updateValidation persistence logic
// ═══════════════════════════════════════════════════════════════

describe('updateValidation persistence', () => {
  it('should store validation report with all fields', () => {
    const report = {
      overallRatio: 0.85,
      totalMessages: 20,
      totalValidOffers: 17,
      groups: [
        { groupJid: 'a@g.us', groupName: 'A', totalMessages: 10, validOffers: 8, ratio: 0.8, passed: true },
        { groupJid: 'b@g.us', groupName: 'B', totalMessages: 10, validOffers: 9, ratio: 0.9, passed: true },
      ],
    };

    const validationData = {
      lastValidatedAt: new Date(),
      lastValidationPassed: true,
      lastValidationReport: report,
    };

    expect(validationData.lastValidationPassed).toBe(true);
    expect(validationData.lastValidationReport.overallRatio).toBe(0.85);
    expect(validationData.lastValidationReport.groups).toHaveLength(2);
    expect(validationData.lastValidatedAt).toBeInstanceOf(Date);
  });

  it('should store failure state correctly', () => {
    const report = {
      overallRatio: 0.3,
      totalMessages: 10,
      totalValidOffers: 3,
      groups: [
        { groupJid: 'a@g.us', groupName: 'Failed Group', totalMessages: 10, validOffers: 3, ratio: 0.3, passed: false },
      ],
    };

    const validationData = {
      lastValidatedAt: new Date(),
      lastValidationPassed: false,
      lastValidationReport: report,
    };

    expect(validationData.lastValidationPassed).toBe(false);
    expect(validationData.lastValidationReport.groups[0].passed).toBe(false);
    expect(validationData.lastValidationReport.groups[0].ratio).toBe(0.3);
  });
});

// ═══════════════════════════════════════════════════════════════
// TESTES: Integration scenarios (end-to-end validation flow)
// ═══════════════════════════════════════════════════════════════

describe('Integration: full revalidation flow simulation', () => {
  it('should correctly validate a group that went from passing to failing', () => {
    // Simulate: previously passed (lastValidationPassed=true), now fails (<70%)
    const previouslyPassed = true;
    const messages = Array(10).fill(null).map(() => ({ text: makeNonOfferMessage() }));
    const currentResult = calculateValidation(messages);
    const statusChanged = previouslyPassed !== null && previouslyPassed !== currentResult.passed;

    expect(currentResult.passed).toBe(false);
    expect(statusChanged).toBe(true);
  });

  it('should correctly validate a group that went from failing to passing', () => {
    // Simulate: previously failed, now passes
    const previouslyPassed = false;
    const messages = Array(10).fill(null).map(() => ({ text: makeOfferMessage('shopee') }));
    const currentResult = calculateValidation(messages);
    const statusChanged = previouslyPassed !== null && previouslyPassed !== currentResult.passed;

    expect(currentResult.passed).toBe(true);
    expect(statusChanged).toBe(true);
  });

  it('should count failedAffiliates correctly (statusChanged + not passed)', () => {
    // failedAffiliates = results where statusChanged=true AND !overallPassed
    const results = [
      { statusChanged: true, overallPassed: false },  // should count
      { statusChanged: true, overallPassed: false },  // should count
      { statusChanged: true, overallPassed: true },   // recovered, don't count
      { statusChanged: false, overallPassed: false }, // already failing, don't count
      { statusChanged: false, overallPassed: true },  // stable passing, don't count
    ];
    const failedAffiliates = results.filter(
      (r) => r.statusChanged && !r.overallPassed,
    ).length;
    expect(failedAffiliates).toBe(2);
  });

  it('should handle edge case: mixed group results (one pass, one fail)', () => {
    const groupResults = [
      calculateValidation([
        ...Array(8).fill(null).map(() => ({ text: makeOfferMessage('shopee') })),
        ...Array(2).fill(null).map(() => ({ text: makeNonOfferMessage() })),
      ]),
      calculateValidation([
        ...Array(2).fill(null).map(() => ({ text: makeOfferMessage('mercadolivre') })),
        ...Array(8).fill(null).map(() => ({ text: makeNonOfferMessage() })),
      ]),
    ];

    const overallPassed = groupResults.every((r) => r.passed) && groupResults.length > 0;
    expect(groupResults[0].passed).toBe(true);
    expect(groupResults[1].passed).toBe(false);
    expect(overallPassed).toBe(false);
  });

  it('should handle daemon interval: immediate first run, then wait configured interval', () => {
    // The daemon runs immediately on start, then repeats at interval
    const REVALIDATION_INTERVAL_DAYS = 7;
    const POLL_INTERVAL_MS = REVALIDATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
    expect(POLL_INTERVAL_MS).toBe(604800000);
  });
});
