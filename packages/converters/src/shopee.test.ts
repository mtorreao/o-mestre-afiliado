/**
 * Testes do conversor de Shopee.
 *
 * Cobre:
 *  - extractShopeeItemIdFromUrl (via _testExport)
 *  - extractShopeeSlug (via _testExport)
 *  - convertShopeeUrlWithCredentials: validação de URL não-Shopee,
 *    resposta de sucesso com shortLink, resposta de erro da API,
 *    fetch mockado.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  convertShopeeUrlWithCredentials,
  _testExtractShopeeItemIdFromUrl,
  _testExtractShopeeSlug,
} from './shopee.ts';

const validCreds = { appId: '12345', secret: 'abcdef' };

describe('extractShopeeItemIdFromUrl', () => {
  describe('formato -i.SHOPID.ITEMID', () => {
    it('extrai itemId do padrão canônico', () => {
      expect(
        _testExtractShopeeItemIdFromUrl('https://shopee.com.br/Capinha-iPhone-i.123.456'),
      ).toBe(456);
    });

    it('extrai itemId quando há query string', () => {
      expect(
        _testExtractShopeeItemIdFromUrl('https://shopee.com.br/Capinha-i.999.888?sp_atk=abc'),
      ).toBe(888);
    });

    it('extrai itemId grande (10+ dígitos)', () => {
      expect(
        _testExtractShopeeItemIdFromUrl('https://shopee.com.br/Produto-i.111222333.1234567890123'),
      ).toBe(1234567890123);
    });
  });

  describe('formato /product/{shopid}/{itemid}', () => {
    it('extrai itemId do formato product', () => {
      expect(_testExtractShopeeItemIdFromUrl('https://shopee.com.br/product/123/456')).toBe(456);
    });
  });

  describe('formato /opaanlp/{shopid}/{itemid} (novo short link)', () => {
    it('extrai itemId do formato opaanlp', () => {
      expect(
        _testExtractShopeeItemIdFromUrl('https://shopee.com.br/opaanlp/946161700/23091599945'),
      ).toBe(23091599945);
    });

    it('extrai itemId do formato opaanlp mesmo com query string', () => {
      expect(
        _testExtractShopeeItemIdFromUrl(
          'https://shopee.com.br/opaanlp/1242044379/22092998564?__mobile__=1&exp_group=rollout',
        ),
      ).toBe(22092998564);
    });
  });

  describe('retorna null', () => {
    it('URL sem padrão -i. nem /product/', () => {
      expect(_testExtractShopeeItemIdFromUrl('https://shopee.com.br/Capinha-iPhone')).toBeNull();
    });

    it('URL não-Shopee', () => {
      expect(_testExtractShopeeItemIdFromUrl('https://example.com/i.123.456')).toBeNull();
    });

    it('URL vazia', () => {
      expect(_testExtractShopeeItemIdFromUrl('')).toBeNull();
    });
  });
});

describe('extractShopeeSlug', () => {
  it('extrai slug antes de -i.', () => {
    expect(_testExtractShopeeSlug('https://shopee.com.br/Capinha-iPhone-i.123.456')).toBe(
      'Capinha-iPhone',
    );
  });

  it('extrai slug sem -i. quando não tem padrão', () => {
    expect(_testExtractShopeeSlug('https://shopee.com.br/Capinha-iPhone')).toBe('Capinha-iPhone');
  });

  it('ignora path /product/', () => {
    // /product/{shopid}/{itemid} → não é slug de produto
    expect(_testExtractShopeeSlug('https://shopee.com.br/product/123/456')).toBe(null);
  });

  it('retorna null para URL não-Shopee', () => {
    expect(_testExtractShopeeSlug('https://example.com/Meu-Produto')).toBeNull();
  });

  it('retorna null para URL vazia', () => {
    expect(_testExtractShopeeSlug('')).toBeNull();
  });
});

describe('convertShopeeUrlWithCredentials', () => {
  describe('validação de entrada', () => {
    it('retorna erro quando URL não é da Shopee', async () => {
      const result = await convertShopeeUrlWithCredentials(
        'https://www.mercadolivre.com.br/produto',
        validCreds,
      );
      expect(result.success).toBe(false);
      expect(result.marketplace).toBe('mercadolivre');
      expect(result.error).toContain('URL não é da Shopee');
    });

    it('retorna erro para URL vazia', async () => {
      const result = await convertShopeeUrlWithCredentials('', validCreds);
      expect(result.success).toBe(false);
      expect(result.error).toContain('URL não é da Shopee');
    });
  });

  describe('sucesso — shortLink retornado', () => {
    let originalFetch: typeof fetch;
    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('constrói auth header SHA256 e retorna shortLink', async () => {
      const fakeResponse = {
        ok: true,
        json: async () => ({
          data: {
            generateShortLink: {
              shortLink: 'https://shp.ee/abc123',
            },
          },
        }),
      };

      let capturedHeaders: Record<string, string> | undefined;
      let capturedBody: string | undefined;

      const fakeFetch = mock(async (url: string, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        capturedBody = init?.body as string;
        return fakeResponse;
      });
      globalThis.fetch = fakeFetch as unknown as typeof fetch;

      const result = await convertShopeeUrlWithCredentials(
        'https://shopee.com.br/Capinha-iPhone-i.123.456',
        validCreds,
      );

      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe('https://shp.ee/abc123');
      expect(result.method).toBe('api');
      expect(result.marketplace).toBe('shopee');

      // Verifica que o Authorization tem o formato correto com SHA256
      expect(capturedHeaders?.Authorization).toMatch(
        /^SHA256 Credential=12345, Timestamp=\d+, Signature=[a-f0-9]{64}$/,
      );
      expect(capturedHeaders?.['Content-Type']).toBe('application/json');
      expect(capturedBody).toContain('generateShortLink');
    });

    it('detecta erro GraphQL (errors[0].message)', async () => {
      const fakeResponse = {
        ok: true,
        json: async () => ({
          errors: [{ message: 'invalid app id' }],
        }),
      };

      globalThis.fetch = mock(async () => fakeResponse) as unknown as typeof fetch;

      const result = await convertShopeeUrlWithCredentials(
        'https://shopee.com.br/Capinha-iPhone-i.123.456',
        validCreds,
      );

      expect(result.success).toBe(false);
      expect(result.affiliateUrl).toBeNull();
      expect(result.error).toContain('invalid app id');
    });

    it('retorna erro genérico quando API não retorna shortLink nem errors', async () => {
      const fakeResponse = {
        ok: true,
        json: async () => ({ data: { generateShortLink: null } }),
      };

      globalThis.fetch = mock(async () => fakeResponse) as unknown as typeof fetch;

      const result = await convertShopeeUrlWithCredentials(
        'https://shopee.com.br/Capinha-iPhone-i.123.456',
        validCreds,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Falha ao gerar link de afiliado');
    });

    it('retorna erro quando resposta não é ok (HTTP 500)', async () => {
      const fakeResponse = {
        ok: false,
        status: 500,
        json: async () => ({ error: 'server error' }),
      };

      globalThis.fetch = mock(async () => fakeResponse) as unknown as typeof fetch;

      const result = await convertShopeeUrlWithCredentials(
        'https://shopee.com.br/Capinha-iPhone-i.123.456',
        validCreds,
      );

      // A função não verifica res.ok explicitamente — só vê se há data
      // e shortLink. Sem errors, cai no fallback "Falha ao gerar link".
      expect(result.success).toBe(false);
    });
  });

  describe('tratamento de exceção', () => {
    it('retorna erro quando fetch lança exceção', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () => {
        throw new Error('network boom');
      }) as unknown as typeof fetch;

      try {
        const result = await convertShopeeUrlWithCredentials(
          'https://shopee.com.br/Capinha-iPhone-i.123.456',
          validCreds,
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('network boom');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
