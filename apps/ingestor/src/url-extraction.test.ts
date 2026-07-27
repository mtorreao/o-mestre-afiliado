import { describe, expect, it } from 'bun:test';
import {
  classifyLinkKind,
  extractAllMarketplaceLinks,
  extractMarketplaceUrl,
  sanitizeNonOfferLinks,
  type LinkKind,
} from './url-extraction.ts';

describe('classifyLinkKind', () => {
  it('classifica redirector de cupom go.promozone.ai como coupon', () => {
    expect(classifyLinkKind('https://go.promozone.ai/abc123')).toBe('coupon');
  });

  it('classifica shortlink s.shopee.com.br como coupon', () => {
    expect(classifyLinkKind('https://s.shopee.com.br/ABCdef123')).toBe('coupon');
  });

  it('classifica URLs de voucher/cupom óbvias como coupon', () => {
    expect(classifyLinkKind('https://loja.com/voucher/xyz')).toBe('coupon');
    expect(classifyLinkKind('https://loja.com/cupom/xyz')).toBe('coupon');
    expect(classifyLinkKind('https://loja.com/claim/xyz')).toBe('coupon');
    expect(classifyLinkKind('https://loja.com/coupons/xyz')).toBe('coupon');
    expect(classifyLinkKind('https://loja.com/voucher-wallet/xyz')).toBe('coupon');
  });

  it('classifica Shopee produto (-i.SHOPID.ITEMID) como product', () => {
    expect(classifyLinkKind('https://shopee.com.br/Perfume-i.1006874942.23694247133')).toBe(
      'product',
    );
    // SHOPID.ITEMID após barra também
    expect(classifyLinkKind('https://shopee.com.br/produto/i.1006874942.23694247133')).toBe(
      'product',
    );
  });

  it('classifica MercadoLivre produto (MLBxxxx, /p/MLB, meli.la) como product', () => {
    expect(classifyLinkKind('https://www.mercadolivre.com.br/MLB12345678')).toBe('product');
    expect(classifyLinkKind('https://produto.mercadolivre.com.br/MLB12345678-slug')).toBe(
      'product',
    );
    expect(classifyLinkKind('https://www.mercadolivre.com.br/p/MLB12345678')).toBe('product');
    expect(classifyLinkKind('https://meli.la/2DSBbLg')).toBe('product');
    // outros países (MLM, MLA, MCO, MLC)
    expect(classifyLinkKind('https://www.mercadolibre.com.mx/MLM12345678')).toBe('product');
    expect(classifyLinkKind('https://www.mercadolibre.com.ar/MLA12345678')).toBe('product');
    expect(classifyLinkKind('https://www.mercadolibre.com.co/MCO12345678')).toBe('product');
    expect(classifyLinkKind('https://www.mercadolibre.cl/MLC12345678')).toBe('product');
  });

  it('classifica Amazon produto (/dp/ASIN, /gp/product/ASIN) como product', () => {
    expect(classifyLinkKind('https://www.amazon.com.br/dp/B0C1234567')).toBe('product');
    expect(classifyLinkKind('https://www.amazon.com.br/gp/product/B0C1234567')).toBe('product');
  });

  it('classifica magalu e shortlinks não resolvidos como other', () => {
    expect(classifyLinkKind('https://www.magazineluiza.com.br/produto-x')).toBe('other');
    expect(classifyLinkKind('https://s.shopee.com.br/naoresolvido')).toBe('coupon');
  });
});

describe('extractAllMarketplaceLinks', () => {
  it('retorna [] quando não há URLs', () => {
    expect(extractAllMarketplaceLinks('sem links aqui')).toEqual([]);
  });

  it('retorna [] quando não há links de marketplace conhecidos', () => {
    expect(extractAllMarketplaceLinks('veja https://exemplo.com/foo')).toEqual([]);
  });

  it('extrai e classifica múltiplos links de marketplace', () => {
    const text =
      'Oferta: https://shopee.com.br/Perfume-i.1006874942.23694247133 e ' +
      'https://www.mercadolivre.com.br/MLB12345678 e cupom https://s.shopee.com.br/ABC';
    const links = extractAllMarketplaceLinks(text);
    const kinds: LinkKind[] = links.map((l) => l.kind).sort();
    expect(links.length).toBe(3);
    expect(kinds).toEqual(['coupon', 'product', 'product']);
    expect(links[0]!.url).toContain('shopee.com.br');
  });

  it('ignora URLs de marketplace unknown', () => {
    const links = extractAllMarketplaceLinks('https://sitequalquer.com/xyz');
    expect(links.length).toBe(0);
  });
});

describe('extractMarketplaceUrl', () => {
  it('retorna null quando não há links', () => {
    expect(extractMarketplaceUrl('nada')).toBeNull();
  });

  it('prioriza link não-cupom (produto) sobre cupom', () => {
    const text =
      'cupom https://s.shopee.com.br/ABC e produto ' +
      'https://shopee.com.br/Perfume-i.1006874942.23694247133';
    expect(extractMarketplaceUrl(text)).toContain('Perfume-i');
  });

  it('retorna o cupom quando só há cupons', () => {
    const text = 'cupom https://s.shopee.com.br/ABC';
    expect(extractMarketplaceUrl(text)).toContain('s.shopee.com.br');
  });
});

describe('sanitizeNonOfferLinks', () => {
  it('remove links do Telegram (t.me)', () => {
    expect(sanitizeNonOfferLinks('#MercadoLivre #Parceria | https://t.me/cuponsm')).toBe(
      '#MercadoLivre #Parceria',
    );
  });

  it('remove separadores órfãos no final de linha', () => {
    expect(sanitizeNonOfferLinks('Oferta | ')).toBe('Oferta');
  });

  it('colapsa espaços e linhas vazias extras', () => {
    expect(sanitizeNonOfferLinks('a    b\n\n\n\nc')).toBe('a b\n\nc');
  });

  it('trim de pontas', () => {
    expect(sanitizeNonOfferLinks('  texto  ')).toBe('texto');
  });

  it('mantém links de oferta intactos', () => {
    const text = 'https://shopee.com.br/Perfume-i.1006874942.23694247133';
    expect(sanitizeNonOfferLinks(text)).toBe(text);
  });
});
