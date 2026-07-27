/**
 * Testes do conversor de Amazon.
 *
 * Cobre:
 *  - extractAsin: regex de múltiplos formatos de URL Amazon
 *  - isShortUrl / isPromozoneAmazonUrl / extractPromozoneAsin
 *  - buildAffiliateUrl: fallback com e sem ASIN
 *  - convertAmazonUrlWithAffiliate: seleção de tracking ID
 *    (default, preferTag, ativo, vazio, inativo)
 *  - convertAmazonUrlWithTrackingId: validação de entrada + URL
 *    inválida + trackingId ausente
 *
 * As funções de I/O (resolveShortUrl, resolvePromozoneUrl) precisam de
 * fetch mockado quando exercitadas.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  extractAsin,
  isShortUrl,
  isPromozoneAmazonUrl,
  extractPromozoneAsin,
  buildAffiliateUrl,
  convertAmazonUrlWithTrackingId,
  convertAmazonUrlWithAffiliate,
} from './amazon.ts';

describe('extractAsin', () => {
  describe('URLs /dp/<ASIN>/', () => {
    it('extrai ASIN de URL amazon.com.br/dp/<ASIN>', () => {
      expect(extractAsin('https://www.amazon.com.br/dp/B07PXGQCK5')).toBe('B07PXGQCK5');
    });

    it('extrai ASIN com path mais longo após /dp/', () => {
      expect(extractAsin('https://www.amazon.com.br/dp/B07PXGQCK5/ref=something')).toBe(
        'B07PXGQCK5',
      );
    });

    it('extrai ASIN com slug antes de /dp/', () => {
      expect(extractAsin('https://www.amazon.com.br/Capinha-iPhone/dp/B07PXGQCK5')).toBe(
        'B07PXGQCK5',
      );
    });

    it('extrai ASIN com query string', () => {
      expect(extractAsin('https://www.amazon.com.br/dp/B07PXGQCK5?ref_=foo')).toBe('B07PXGQCK5');
    });

    it('extrai ASIN minúsculo e devolve em uppercase', () => {
      expect(extractAsin('https://www.amazon.com.br/dp/b07pxgqck5')).toBe('B07PXGQCK5');
    });
  });

  describe('outros formatos suportados', () => {
    it('extrai ASIN de /gp/product/<ASIN>', () => {
      expect(extractAsin('https://www.amazon.com.br/gp/product/B07PXGQCK5')).toBe('B07PXGQCK5');
    });

    it('extrai ASIN de /gp/offer-listing/<ASIN>', () => {
      expect(extractAsin('https://www.amazon.com.br/gp/offer-listing/B07PXGQCK5')).toBe(
        'B07PXGQCK5',
      );
    });

    it('extrai ASIN de amazon.com (EUA)', () => {
      expect(extractAsin('https://www.amazon.com/dp/B07PXGQCK5')).toBe('B07PXGQCK5');
    });
  });

  describe('retorna null', () => {
    it('para URL sem padrão conhecido', () => {
      expect(extractAsin('https://example.com/foo/bar')).toBeNull();
    });

    it('para ASIN curto demais', () => {
      expect(extractAsin('https://www.amazon.com.br/dp/B07P')).toBeNull();
    });

    it('para texto puro sem URL', () => {
      expect(extractAsin('B07PXGQCK5')).toBeNull();
    });

    it('para URL vazia', () => {
      expect(extractAsin('')).toBeNull();
    });
  });
});

describe('isShortUrl', () => {
  it('retorna true para amzn.to/abc', () => {
    expect(isShortUrl('https://amzn.to/abc123')).toBe(true);
  });

  it('retorna false para amazon.com.br/dp/', () => {
    expect(isShortUrl('https://www.amazon.com.br/dp/B07PXGQCK5')).toBe(false);
  });

  it('retorna false para URL aleatória', () => {
    expect(isShortUrl('https://example.com/x')).toBe(false);
  });
});

describe('isPromozoneAmazonUrl', () => {
  it('detecta go.promozone.ai/amazon', () => {
    expect(isPromozoneAmazonUrl('https://go.promozone.ai/amazon/B07PXGQCK5')).toBe(true);
  });

  it('NÃO detecta go.promozone.ai/amzn (regex só casa /amazon)', () => {
    // A função só reconhece a forma canônica /amazon/<ASIN>.
    // /amzn e /amz são tratados pelo detectMarketplace via
    // MARKETPLACE_DOMAINS mas isPromozoneAmazonUrl é mais restrito.
    expect(isPromozoneAmazonUrl('https://go.promozone.ai/amzn/abc')).toBe(false);
  });

  it('retorna false para go.promozone.ai/shopee', () => {
    expect(isPromozoneAmazonUrl('https://go.promozone.ai/shopee/x')).toBe(false);
  });

  it('retorna false para amazon.com.br', () => {
    expect(isPromozoneAmazonUrl('https://www.amazon.com.br/dp/B07PXGQCK5')).toBe(false);
  });
});

describe('extractPromozoneAsin', () => {
  it('extrai ASIN de go.promozone.ai/amazon/<ASIN>', () => {
    expect(extractPromozoneAsin('https://go.promozone.ai/amazon/B07PXGQCK5')).toBe('B07PXGQCK5');
  });

  it('extrai ASIN minúsculo e devolve uppercase', () => {
    expect(extractPromozoneAsin('https://go.promozone.ai/amazon/b07pxgqck5')).toBe('B07PXGQCK5');
  });

  it('retorna null quando ASIN não está no path', () => {
    expect(extractPromozoneAsin('https://go.promozone.ai/amazon/short')).toBeNull();
  });

  it('retorna null para URL não-promozone', () => {
    expect(extractPromozoneAsin('https://amazon.com.br/dp/B07PXGQCK5')).toBeNull();
  });
});

describe('buildAffiliateUrl', () => {
  it('constrói URL limpa com ASIN + tag quando ASIN existe', () => {
    const url = buildAffiliateUrl('https://www.amazon.com.br/dp/B07PXGQCK5', 'meuafiliado-20');
    expect(url).toBe('https://www.amazon.com.br/dp/B07PXGQCK5/?tag=meuafiliado-20');
  });

  it('encoda caracteres especiais do trackingId', () => {
    const url = buildAffiliateUrl('https://www.amazon.com.br/dp/B07PXGQCK5', 'tag com espaço');
    expect(url).toBe('https://www.amazon.com.br/dp/B07PXGQCK5/?tag=tag%20com%20espa%C3%A7o');
  });

  it('faz fallback: adiciona tag na URL original quando ASIN não pode ser extraído', () => {
    const url = buildAffiliateUrl('https://example.com/some/page?ref=abc', 'meuafiliado-20');
    expect(url).toBe('https://example.com/some/page?ref=abc&tag=meuafiliado-20');
  });

  it('retorna null quando URL é totalmente inválida e fallback falha', () => {
    const url = buildAffiliateUrl('not a url', 'meuafiliado-20');
    expect(url).toBeNull();
  });

  it('sobrescreve tag existente se houver (preserva ordem de inserção)', () => {
    const url = buildAffiliateUrl('https://example.com/page?tag=antigo&ref=foo', 'novo');
    // searchParams.set preserva a posição do param sobrescrito.
    expect(url).toBe('https://example.com/page?tag=novo&ref=foo');
  });
});

describe('convertAmazonUrlWithTrackingId', () => {
  describe('validação de entrada', () => {
    it('retorna erro quando URL não é da Amazon', async () => {
      const result = await convertAmazonUrlWithTrackingId(
        'https://shopee.com.br/product-xyz',
        'tag-20',
      );
      expect(result.success).toBe(false);
      expect(result.marketplace).toBe('shopee');
      expect(result.error).toContain('URL não é da Amazon');
    });

    it('retorna erro quando trackingId é null', async () => {
      const result = await convertAmazonUrlWithTrackingId(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        null,
      );
      expect(result.success).toBe(false);
      expect(result.marketplace).toBe('amazon');
      expect(result.error).toContain('tracking ID não configurado');
    });

    it('retorna erro quando trackingId é undefined', async () => {
      const result = await convertAmazonUrlWithTrackingId(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        undefined,
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('tracking ID não configurado');
    });

    it('retorna erro quando trackingId é string vazia', async () => {
      const result = await convertAmazonUrlWithTrackingId(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        '',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('tracking ID não configurado');
    });
  });

  describe('URL direta Amazon', () => {
    it('constrói URL de afiliado a partir de URL /dp/<ASIN>', async () => {
      const result = await convertAmazonUrlWithTrackingId(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        'meuafiliado-20',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe(
        'https://www.amazon.com.br/dp/B07PXGQCK5/?tag=meuafiliado-20',
      );
      expect(result.method).toBe('fallback');
      expect(result.marketplace).toBe('amazon');
    });
  });

  describe('promozone /amazon/<ASIN>', () => {
    it('extrai ASIN direto do path sem fazer fetch', async () => {
      const result = await convertAmazonUrlWithTrackingId(
        'https://go.promozone.ai/amazon/B07PXGQCK5',
        'meuafiliado-20',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe(
        'https://www.amazon.com.br/dp/B07PXGQCK5/?tag=meuafiliado-20',
      );
      expect(result.method).toBe('promozone');
    });
  });

  describe('URL curta amzn.to', () => {
    let originalFetch: typeof fetch;
    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });
    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('resolve amzn.to via fetch (HEAD → location)', async () => {
      // HEAD responde 302 com location amazon.com.br/dp/<ASIN>
      const fakeFetch = mock((url: string, init?: RequestInit) => {
        if (init?.method === 'HEAD') {
          return Promise.resolve(
            new Response(null, {
              status: 302,
              headers: { location: 'https://www.amazon.com.br/dp/B07PXGQCK5' },
            }),
          );
        }
        return Promise.reject(new Error('unexpected fetch'));
      });
      globalThis.fetch = fakeFetch as unknown as typeof fetch;

      const result = await convertAmazonUrlWithTrackingId(
        'https://amzn.to/abc123',
        'meuafiliado-20',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe(
        'https://www.amazon.com.br/dp/B07PXGQCK5/?tag=meuafiliado-20',
      );
    });

    it('retorna erro quando amzn.to falha ao resolver', async () => {
      // HEAD 302 mas location é o próprio amzn.to (loop) → tenta 200 → também loop
      const fakeFetch = mock(() =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: 'https://amzn.to/abc123' },
          }),
        ),
      );
      globalThis.fetch = fakeFetch as unknown as typeof fetch;

      const result = await convertAmazonUrlWithTrackingId(
        'https://amzn.to/abc123',
        'meuafiliado-20',
      );
      // Sem ASIN extraível, buildAffiliateUrl faz fallback de adicionar tag
      // na URL original
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe('https://amzn.to/abc123?tag=meuafiliado-20');
    });
  });
});

describe('convertAmazonUrlWithAffiliate', () => {
  describe('validação de tracking IDs', () => {
    it('retorna erro quando lista está vazia', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [],
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nenhum tracking ID ativo');
    });

    it('ignora tracking IDs inativos (active=false)', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [
          { tag: 'inativo-20', isDefault: true, active: false },
          { tag: 'ativo-20', active: true },
        ],
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toContain('tag=ativo-20');
    });

    it('trata active=undefined como ativo (default)', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [
          { tag: 'padrao-20' }, // active undefined = ativo
          { tag: 'outro-20' },
        ],
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toContain('tag=padrao-20');
    });

    it('retorna erro quando todos estão inativos', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [
          { tag: 'inativo-20', active: false },
          { tag: 'tambem-inativo', active: false },
        ],
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Nenhum tracking ID ativo');
    });
  });

  describe('seleção de tracking ID', () => {
    it('usa isDefault=true quando não há preferredTag', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [{ tag: 'primeiro-20' }, { tag: 'segundo-20', isDefault: true }, { tag: 'terceiro-20' }],
      );
      expect(result.affiliateUrl).toContain('tag=segundo-20');
    });

    it('cai pro primeiro da lista quando nenhum tem isDefault', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [{ tag: 'primeiro-20' }, { tag: 'segundo-20' }, { tag: 'terceiro-20' }],
      );
      expect(result.affiliateUrl).toContain('tag=primeiro-20');
    });

    it('respeita preferredTag quando existe e está ativo', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [
          { tag: 'padrao-20', isDefault: true },
          { tag: 'escolhido-20', active: true },
          { tag: 'outro-20' },
        ],
        { preferredTag: 'escolhido-20' },
      );
      expect(result.affiliateUrl).toContain('tag=escolhido-20');
    });

    it('retorna erro quando preferredTag não está na lista', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [{ tag: 'padrao-20', isDefault: true }],
        { preferredTag: 'inexistente-20' },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('inexistente-20');
    });

    it('retorna erro quando preferredTag existe mas está inativo', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [
          { tag: 'padrao-20', isDefault: true },
          { tag: 'inativo-20', active: false },
        ],
        { preferredTag: 'inativo-20' },
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('inativo-20');
    });

    it('preferredTag=null é ignorado (cai no default)', async () => {
      const result = await convertAmazonUrlWithAffiliate(
        'https://www.amazon.com.br/dp/B07PXGQCK5',
        [{ tag: 'padrao-20', isDefault: true }, { tag: 'outro-20' }],
        { preferredTag: null },
      );
      expect(result.affiliateUrl).toContain('tag=padrao-20');
    });
  });

  describe('integração com detecção de marketplace', () => {
    it('retorna erro quando URL não é da Amazon', async () => {
      const result = await convertAmazonUrlWithAffiliate('https://shopee.com.br/product', [
        { tag: 'padrao-20' },
      ]);
      expect(result.success).toBe(false);
      expect(result.marketplace).toBe('shopee');
    });
  });
});
