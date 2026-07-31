/**
 * Testes das funções PURAS em apps/ingestor/src/link-converters-pure.ts.
 *
 * Cobrem 100% da lógica de decisão/classificação/construção extraída da
 * orquestração assíncrona de link-converters.ts — sem rede/DB/Redis.
 */
import { describe, expect, it } from 'bun:test';
import {
  extractUserIdFromInstanceName,
  buildInstanceName,
  resolveEffectiveMarketplace,
  classifyUnsupportedMarketplace,
  buildUnsupportedMarketplaceError,
  toConversionResult,
  buildCachedConversionResult,
  buildBlockedResult,
  isMeliLaShortlink,
  decideMeliProductStatus,
  buildMeliNotProductError,
  isMlCookieError,
  classifyMlShortLinkResult,
  hasShopeeCredentials,
  hasAmazonTrackingIds,
  ML_NO_COOKIES_ERROR,
  ML_NO_TAG_ERROR,
} from './link-converters-pure.ts';

// ─── extractUserIdFromInstanceName ─────────────────────────────────────

describe('extractUserIdFromInstanceName', () => {
  it('extrai userId de user-{id}', () => {
    expect(extractUserIdFromInstanceName('user-42')).toBe(42);
  });

  it('retorna null para formato não user-', () => {
    expect(extractUserIdFromInstanceName('minha-instancia')).toBeNull();
  });

  it('retorna null para string vazia / null / undefined', () => {
    expect(extractUserIdFromInstanceName('')).toBeNull();
    expect(extractUserIdFromInstanceName(null)).toBeNull();
    expect(extractUserIdFromInstanceName(undefined)).toBeNull();
  });

  it('retorna null para sufixo não numérico', () => {
    expect(extractUserIdFromInstanceName('user-abc')).toBeNull();
  });

  it('não aceita prefixo/sufixo extra', () => {
    expect(extractUserIdFromInstanceName('xuser-1')).toBeNull();
    expect(extractUserIdFromInstanceName('user-1x')).toBeNull();
  });
});

// ─── buildInstanceName ─────────────────────────────────────────────────

describe('buildInstanceName', () => {
  it('monta user-{id}', () => {
    expect(buildInstanceName(7)).toBe('user-7');
  });

  it('roundtrip com extractUserIdFromInstanceName', () => {
    expect(extractUserIdFromInstanceName(buildInstanceName(123))).toBe(123);
  });
});

// ─── resolveEffectiveMarketplace ───────────────────────────────────────

describe('resolveEffectiveMarketplace', () => {
  it('mantém o detectado quando não houve redirect', () => {
    const url = 'https://shopee.com.br/produto-i.1.2';
    expect(resolveEffectiveMarketplace('shopee', url, url)).toBe('shopee');
  });

  it('usa marketplace da URL resolvida quando conhecido', () => {
    expect(
      resolveEffectiveMarketplace(
        'mercadolivre',
        'https://meli.la/abc',
        'https://www.mercadolivre.com.br/p/MLB123',
      ),
    ).toBe('mercadolivre');
    expect(
      resolveEffectiveMarketplace(
        'unknown',
        'https://redirector.example/x',
        'https://www.amazon.com.br/dp/B0ABCDEF12',
      ),
    ).toBe('amazon');
  });

  it('mantém o detectado quando URL resolvida é unknown', () => {
    expect(
      resolveEffectiveMarketplace(
        'shopee',
        'https://shope.ee/abc',
        'https://site-qualquer.example/final',
      ),
    ).toBe('shopee');
  });
});

// ─── classifyUnsupportedMarketplace ────────────────────────────────────

describe('classifyUnsupportedMarketplace', () => {
  it('magalu não é mais bloqueado (integrado)', () => {
    expect(classifyUnsupportedMarketplace('magalu')).toBeNull();
  });

  it('marketplaces suportados retornam null', () => {
    expect(classifyUnsupportedMarketplace('shopee')).toBeNull();
    expect(classifyUnsupportedMarketplace('mercadolivre')).toBeNull();
    expect(classifyUnsupportedMarketplace('amazon')).toBeNull();
    expect(classifyUnsupportedMarketplace('unknown')).toBeNull();
  });
});

// ─── buildUnsupportedMarketplaceError ──────────────────────────────────

describe('buildUnsupportedMarketplaceError', () => {
  it('monta mensagem PT-BR', () => {
    expect(buildUnsupportedMarketplaceError('Marketplace Futuro')).toBe(
      'Marketplace ainda não liberado: Marketplace Futuro',
    );
  });
});

// ─── toConversionResult ────────────────────────────────────────────────

describe('toConversionResult', () => {
  it('mapeia sucesso do conversor', () => {
    expect(
      toConversionResult('shopee', {
        affiliateUrl: 'https://s.shopee.com.br/xyz',
        success: true,
      }),
    ).toEqual({
      convertedUrl: 'https://s.shopee.com.br/xyz',
      marketplace: 'shopee',
      success: true,
      error: undefined,
    });
  });

  it('mapeia falha do conversor com erro', () => {
    expect(
      toConversionResult('amazon', {
        affiliateUrl: null,
        success: false,
        error: 'boom',
      }),
    ).toEqual({
      convertedUrl: null,
      marketplace: 'amazon',
      success: false,
      error: 'boom',
    });
  });
});

// ─── buildCachedConversionResult ───────────────────────────────────────

describe('buildCachedConversionResult', () => {
  it('cache hit com URL → success true', () => {
    expect(
      buildCachedConversionResult({
        convertedUrl: 'https://meli.la/ok',
        marketplace: 'mercadolivre',
      }),
    ).toEqual({
      convertedUrl: 'https://meli.la/ok',
      marketplace: 'mercadolivre',
      success: true,
    });
  });

  it('cache hit de conversão falhada → success false', () => {
    expect(buildCachedConversionResult({ convertedUrl: null, marketplace: 'shopee' })).toEqual({
      convertedUrl: null,
      marketplace: 'shopee',
      success: false,
    });
  });
});

// ─── buildBlockedResult ────────────────────────────────────────────────

describe('buildBlockedResult', () => {
  it('monta resultado bloqueado', () => {
    expect(buildBlockedResult('mercadolivre', ML_NO_COOKIES_ERROR)).toEqual({
      convertedUrl: null,
      marketplace: 'mercadolivre',
      success: false,
      error: 'Sem cookies de sessão ML para usar o Link Builder',
    });
  });

  it('constantes de erro do ML têm o texto esperado', () => {
    expect(ML_NO_TAG_ERROR).toContain('melitat');
    expect(ML_NO_TAG_ERROR).toContain('extensão Chrome');
  });
});

// ─── isMeliLaShortlink / decideMeliProductStatus ───────────────────────

describe('isMeliLaShortlink', () => {
  it('detecta meli.la (case-insensitive)', () => {
    expect(isMeliLaShortlink('https://meli.la/2abc')).toBe(true);
    expect(isMeliLaShortlink('https://MELI.LA/2abc')).toBe(true);
  });

  it('URLs diretas do ML não são shortlink', () => {
    expect(isMeliLaShortlink('https://www.mercadolivre.com.br/p/MLB123')).toBe(false);
  });
});

describe('decideMeliProductStatus', () => {
  it('shortlink meli.la confia no isProduct do redirect', () => {
    expect(decideMeliProductStatus('https://meli.la/abc', true, false)).toBe(true);
    expect(decideMeliProductStatus('https://meli.la/abc', false, true)).toBe(false);
  });

  it('URL direta usa a classificação da URL resolvida', () => {
    expect(decideMeliProductStatus('https://www.mercadolivre.com.br/x', false, true)).toBe(true);
    expect(decideMeliProductStatus('https://www.mercadolivre.com.br/x', true, false)).toBe(false);
  });
});

// ─── buildMeliNotProductError ──────────────────────────────────────────

describe('buildMeliNotProductError', () => {
  it('usa reason quando presente', () => {
    expect(buildMeliNotProductError('social_profile')).toBe(
      'meli.la não redireciona para produto: social_profile',
    );
  });

  it('fallback not_product_url quando reason undefined', () => {
    expect(buildMeliNotProductError(undefined)).toBe(
      'meli.la não redireciona para produto: not_product_url',
    );
  });
});

// ─── isMlCookieError / classifyMlShortLinkResult ───────────────────────

describe('isMlCookieError', () => {
  it('detecta HTTP 40x', () => {
    expect(isMlCookieError('HTTP 401 ao chamar Link Builder')).toBe(true);
    expect(isMlCookieError('HTTP 403')).toBe(true);
  });

  it('detecta mensagem explícita de cookies expirados', () => {
    expect(isMlCookieError('Cookies podem estar expirados')).toBe(true);
  });

  it('detecta unauthorized (case-insensitive)', () => {
    expect(isMlCookieError('Request Unauthorized')).toBe(true);
    expect(isMlCookieError('UNAUTHORIZED')).toBe(true);
  });

  it('não classifica erros genéricos como cookie', () => {
    expect(isMlCookieError('erro 111: url inválida')).toBe(false);
    expect(isMlCookieError('HTTP 500')).toBe(false);
  });
});

describe('classifyMlShortLinkResult', () => {
  it('sucesso com shortUrl', () => {
    expect(classifyMlShortLinkResult({ success: true, shortUrl: 'https://meli.la/x' })).toEqual({
      kind: 'success',
      shortUrl: 'https://meli.la/x',
    });
  });

  it('success=true sem shortUrl NÃO é sucesso', () => {
    expect(classifyMlShortLinkResult({ success: true, shortUrl: null })).toEqual({
      kind: 'rejected',
      errorMsg: 'erro desconhecido',
    });
  });

  it('erro de cookie → cookie_error', () => {
    expect(classifyMlShortLinkResult({ success: false, error: 'HTTP 401 unauthorized' })).toEqual({
      kind: 'cookie_error',
      errorMsg: 'HTTP 401 unauthorized',
    });
  });

  it('falha genérica → rejected com a mensagem original', () => {
    expect(classifyMlShortLinkResult({ success: false, error: 'erro 111: rejeitado' })).toEqual({
      kind: 'rejected',
      errorMsg: 'erro 111: rejeitado',
    });
  });

  it('falha sem error → rejected com erro desconhecido', () => {
    expect(classifyMlShortLinkResult({ success: false })).toEqual({
      kind: 'rejected',
      errorMsg: 'erro desconhecido',
    });
  });
});

// ─── hasShopeeCredentials / hasAmazonTrackingIds ───────────────────────

describe('hasShopeeCredentials', () => {
  it('true quando appId e secret presentes', () => {
    expect(hasShopeeCredentials({ shopeeAppId: 'id', shopeeAppSecret: 'secret' })).toBe(true);
  });

  it('false quando falta um dos dois', () => {
    expect(hasShopeeCredentials({ shopeeAppId: 'id', shopeeAppSecret: null })).toBe(false);
    expect(hasShopeeCredentials({ shopeeAppId: '', shopeeAppSecret: 's' })).toBe(false);
  });

  it('false para null/undefined', () => {
    expect(hasShopeeCredentials(null)).toBe(false);
    expect(hasShopeeCredentials(undefined)).toBe(false);
  });
});

describe('hasAmazonTrackingIds', () => {
  it('true com pelo menos um trackingId', () => {
    expect(hasAmazonTrackingIds({ trackingIds: ['meu-tag-20'] })).toBe(true);
  });

  it('false com lista vazia / null / afiliado ausente', () => {
    expect(hasAmazonTrackingIds({ trackingIds: [] })).toBe(false);
    expect(hasAmazonTrackingIds({ trackingIds: null })).toBe(false);
    expect(hasAmazonTrackingIds(null)).toBe(false);
    expect(hasAmazonTrackingIds(undefined)).toBe(false);
  });
});
