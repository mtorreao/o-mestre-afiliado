/**
 * Testes das funções puras em apps/ingestor/src/ingestor.ts.
 *
 * Cobre:
 *  - classifyLinkKind(url): classifica produto/cupom/outro
 *  - extractAllMarketplaceLinks(text): extrai todos os links de marketplace
 *  - extractMarketplaceUrl(text): primeira URL (não-cupom preferida)
 *  - sanitizeNonOfferLinks(text): remove t.me, separadores órfãos, espaços
 *
 * Pipeline principal (processRawEvent, initMetrics) fica fora — depende
 * de Redis + DB + Evolution API.
 */
import { describe, expect, it } from 'bun:test';
import {
  classifyLinkKind,
  extractAllMarketplaceLinks,
  extractMarketplaceUrl,
  sanitizeNonOfferLinks,
} from './ingestor.ts';

describe('classifyLinkKind', () => {
  describe('retorna "coupon"', () => {
    it('para go.promozone.ai (redirector de afiliado)', () => {
      expect(classifyLinkKind('https://go.promozone.ai/mercadolivre/x')).toBe('coupon');
    });

    it('para s.shopee.com.br (shortlink de afiliado)', () => {
      expect(classifyLinkKind('https://s.shopee.com.br/abc123')).toBe('coupon');
    });

    it('para URL com /voucher', () => {
      expect(classifyLinkKind('https://example.com/voucher/123')).toBe('coupon');
    });

    it('para URL com /coupon', () => {
      expect(classifyLinkKind('https://example.com/coupon/abc')).toBe('coupon');
    });

    it('para URL com /coupons', () => {
      expect(classifyLinkKind('https://example.com/coupons/abc')).toBe('coupon');
    });

    it('para URL com /claim', () => {
      expect(classifyLinkKind('https://example.com/claim/123')).toBe('coupon');
    });

    it('para URL com /cupom', () => {
      expect(classifyLinkKind('https://example.com/cupom/123')).toBe('coupon');
    });
  });

  describe('retorna "product"', () => {
    it('para URL Shopee com -i.SHOPID.ITEMID (formato canônico)', () => {
      expect(classifyLinkKind('https://shopee.com.br/Capinha-i.123.456')).toBe('product');
    });

    it('para URL Shopee com slug + -i.SHOPID.ITEMID', () => {
      expect(classifyLinkKind('https://shopee.com.br/Produto-Legal-i.111222333.123456789')).toBe(
        'product',
      );
    });

    it('para URL ML com MLB+digits', () => {
      expect(classifyLinkKind('https://www.mercadolivre.com.br/MLB123456789')).toBe('product');
    });

    it('para URL ML com /p/MLB', () => {
      expect(classifyLinkKind('https://www.mercadolivre.com.br/p/MLB123456789')).toBe('product');
    });

    it('para URL ML com meli.la', () => {
      expect(classifyLinkKind('https://meli.la/abc123')).toBe('product');
    });

    it('para URL Amazon com /dp/ASIN', () => {
      expect(classifyLinkKind('https://www.amazon.com.br/dp/B07PXGQCK5')).toBe('product');
    });

    it('para URL Amazon com /gp/product/ASIN', () => {
      expect(classifyLinkKind('https://www.amazon.com.br/gp/product/B07PXGQCK5')).toBe('product');
    });
  });

  describe('retorna "other"', () => {
    it('para URL de Magalu (não casa nos padrões de produto)', () => {
      expect(classifyLinkKind('https://www.magalu.com.br/produto/123')).toBe('other');
    });

    it('para URL de shortlink não-resolvido', () => {
      expect(classifyLinkKind('https://maga.lu/abc')).toBe('other');
    });
  });
});

describe('extractAllMarketplaceLinks', () => {
  it('retorna [] para texto sem URLs', () => {
    expect(extractAllMarketplaceLinks('Apenas texto sem links')).toEqual([]);
  });

  it('retorna [] quando URLs são de domínios não-marketplace', () => {
    expect(
      extractAllMarketplaceLinks('Veja https://example.com/foo e https://google.com/search'),
    ).toEqual([]);
  });

  it('extrai 1 link de marketplace', () => {
    const result = extractAllMarketplaceLinks('Oferta: https://shopee.com.br/Produto-i.123.456');
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toBe('https://shopee.com.br/Produto-i.123.456');
    expect(result[0]!.kind).toBe('product');
  });

  it('extrai múltiplos links de marketplaces diferentes', () => {
    const text = `Shopee: https://shopee.com.br/X-i.123.456
      ML: https://www.mercadolivre.com.br/p/MLB123
      Amazon: https://www.amazon.com.br/dp/B07PXGQCK5`;
    // O regex captura URLs http/https que não contenham whitespace/aspas.
    // Em texto multi-linha com indentação, cada link fica na sua própria
    // linha e é capturado separadamente. Pode haver um match extra se
    // houver fragmento tipo "Shopee:" antes — mas como a regex exige
    // protocolo http(s), só conta URLs reais.
    const result = extractAllMarketplaceLinks(text);
    const marketplaceUrls = result.map((l) => l.url);
    expect(marketplaceUrls.some((u) => u.includes('shopee.com.br'))).toBe(true);
    expect(marketplaceUrls.some((u) => u.includes('mercadolivre.com.br'))).toBe(true);
    expect(marketplaceUrls.some((u) => u.includes('amazon.com.br'))).toBe(true);
  });

  it('filtra URLs não-marketplace mantendo só as válidas', () => {
    const text = `Veja https://example.com/foo
      Oferta https://shopee.com.br/X-i.123.456
      Mais em https://google.com/search`;
    const result = extractAllMarketplaceLinks(text);
    expect(result).toHaveLength(1);
    expect(result[0]!.url).toContain('shopee.com.br');
  });

  it('marca links como "coupon" quando aplicável', () => {
    const result = extractAllMarketplaceLinks('Cupom: https://s.shopee.com.br/abc123');
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('coupon');
  });

  it('preserva ordem de aparição no texto', () => {
    const text = `Primeiro https://shopee.com.br/A-i.1.2
      Segundo https://www.mercadolivre.com.br/MLB999999999
      Terceiro https://www.amazon.com.br/dp/B07PXGQCK5`;
    const result = extractAllMarketplaceLinks(text);
    expect(result[0]!.url).toContain('shopee.com.br');
    expect(result[1]!.url).toContain('mercadolivre.com.br');
    expect(result[2]!.url).toContain('amazon.com.br');
  });
});

describe('extractMarketplaceUrl', () => {
  it('retorna primeira URL de marketplace', () => {
    const url = extractMarketplaceUrl('Oferta https://shopee.com.br/X-i.123.456 imperdível');
    expect(url).toBe('https://shopee.com.br/X-i.123.456');
  });

  it('retorna null para texto sem URL de marketplace', () => {
    expect(extractMarketplaceUrl('apenas texto sem URL')).toBeNull();
  });

  it('prefere link não-cupom quando há múltiplos', () => {
    const url = extractMarketplaceUrl(
      'Cupom: https://s.shopee.com.br/abc e Oferta: https://shopee.com.br/X-i.123.456',
    );
    expect(url).toBe('https://shopee.com.br/X-i.123.456');
  });

  it('cai pro primeiro link quando todos são cupom', () => {
    const url = extractMarketplaceUrl(
      'Cupom 1: https://s.shopee.com.br/aaa e Cupom 2: https://s.shopee.com.br/bbb',
    );
    expect(url).toBe('https://s.shopee.com.br/aaa');
  });
});

describe('sanitizeNonOfferLinks', () => {
  describe('remove URLs de Telegram (t.me)', () => {
    it('remove https://t.me/* do texto', () => {
      // A regex só captura t.me precedido de http(s):// — URLs bare
      // (sem protocolo) passam por essa função. Use o formato com
      // protocolo para verificar a remoção.
      const text = '#MercadoLivre #Parceria | https://t.me/cuponsm';
      expect(sanitizeNonOfferLinks(text)).toBe('#MercadoLivre #Parceria');
    });

    it('remove https://t.me/cupons/123 do meio do texto', () => {
      const text = 'Oferta incrível! https://t.me/cupons/123 imperdível';
      const sanitized = sanitizeNonOfferLinks(text);
      expect(sanitized).not.toContain('t.me');
      expect(sanitized).toContain('Oferta incrível!');
      expect(sanitized).toContain('imperdível');
    });

    it('remove https://t.me/* mesmo no meio do texto', () => {
      const text = 'Antes https://t.me/canal depois';
      expect(sanitizeNonOfferLinks(text)).toBe('Antes depois');
    });

    it('preserva URLs não-t.me', () => {
      const text = 'Oferta https://shopee.com.br/X-i.123.456 | siga https://t.me/cuponsm';
      const sanitized = sanitizeNonOfferLinks(text);
      expect(sanitized).toContain('shopee.com.br');
      expect(sanitized).not.toContain('t.me');
    });
  });

  describe('limpeza de espaços e separadores', () => {
    it('remove separador órfão "|" no fim de linha', () => {
      const text = 'linha 1 | \nlinha 2';
      const sanitized = sanitizeNonOfferLinks(text);
      expect(sanitized).not.toMatch(/\|\s*$/m);
    });

    it('remove múltiplos espaços consecutivos', () => {
      const text = 'palavra1    palavra2      palavra3';
      expect(sanitizeNonOfferLinks(text)).toBe('palavra1 palavra2 palavra3');
    });

    it('limpa múltiplas linhas vazias (>2) para 2', () => {
      const text = 'linha1\n\n\n\n\nlinha2';
      expect(sanitizeNonOfferLinks(text)).toBe('linha1\n\nlinha2');
    });

    it('faz trim nas pontas', () => {
      expect(sanitizeNonOfferLinks('   texto   ')).toBe('texto');
    });
  });

  describe('casos compostos', () => {
    it('remove t.me + separador órfão + linhas vazias extras', () => {
      const text = '#Oferta incrível | https://t.me/cupons\n\n\n\nFim';
      const sanitized = sanitizeNonOfferLinks(text);
      expect(sanitized).not.toContain('t.me');
      expect(sanitized).not.toMatch(/\|\s*$/m);
      expect(sanitized).not.toMatch(/\n{3,}/);
    });

    it('preserva texto sem URLs intacto (só faz trim)', () => {
      const text = '  Apenas texto puro sem links  ';
      expect(sanitizeNonOfferLinks(text)).toBe('Apenas texto puro sem links');
    });
  });
});
