/**
 * Testes das funções PURAS de parsing/construção de imagem em
 * apps/ingestor/src/product-image.ts.
 *
 * Cobrem 100% das funções de extração de URL (Shopee/ML/Amazon), do cache
 * key (SHA-256), do ensureHttps e dos extractores de og:image / Amazon
 * dynamic image — tudo sem rede/DB/Redis. A orquestração assíncrona
 * (fetchProductImage, etc.) não é exercitada aqui.
 *
 * NOTA: `extractOgImageFromHtml` e `extractSocialProductDataFromHtml` já
 * são cobertos por product-image.test.ts / resolve-social-product.test.ts;
 * este arquivo foca nas funções que eram `function` privadas e agora são
 * exportadas para teste.
 */
import { describe, expect, it } from 'bun:test';
import {
  productImageCacheKey,
  extractShopeeItemId,
  extractShopeeShopId,
  extractShopeeSlug,
  extractMlItemId,
  extractAmazonAsin,
  ensureHttps,
  extractOgImage,
  extractAmazonDynamicImage,
} from './product-image.ts';

// ─── productImageCacheKey ─────────────────────────────────────────────

describe('productImageCacheKey (pura)', () => {
  it('prefixa com product-image:', () => {
    expect(productImageCacheKey('https://x.com/a').startsWith('product-image:')).toBe(true);
  });

  it('mesma URL → mesma chave (determinístico)', () => {
    const url = 'https://shopee.com.br/produto-i.1.2';
    expect(productImageCacheKey(url)).toBe(productImageCacheKey(url));
  });

  it('URLs diferentes → chaves diferentes', () => {
    expect(productImageCacheKey('https://a.com')).not.toBe(productImageCacheKey('https://b.com'));
  });

  it('chave tem 64 chars hex após o prefixo (SHA-256)', () => {
    const hash = productImageCacheKey('https://x.com').replace('product-image:', '');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('diferença de um caractere muda a chave', () => {
    expect(productImageCacheKey('https://x.com/a')).not.toBe(
      productImageCacheKey('https://x.com/b'),
    );
  });
});

// ─── extractShopeeItemId ──────────────────────────────────────────────

describe('extractShopeeItemId', () => {
  it('extrai itemId do formato -i.SHOPID.ITEMID', () => {
    expect(extractShopeeItemId('https://shopee.com.br/Capinha-i.1495837089.58258815395')).toBe(
      '58258815395',
    );
  });

  it('extrai itemId do formato /product/SHOPID/ITEMID', () => {
    expect(extractShopeeItemId('https://shopee.com.br/product/1500679968/58256271370')).toBe(
      '58256271370',
    );
  });

  it('retorna null quando não há itemId', () => {
    expect(extractShopeeItemId('https://shopee.com.br/alguma-pagina')).toBeNull();
  });

  it('retorna null para URL vazia', () => {
    expect(extractShopeeItemId('')).toBeNull();
  });
});

// ─── extractShopeeShopId ──────────────────────────────────────────────

describe('extractShopeeShopId', () => {
  it('extrai shopId do formato -i.SHOPID.ITEMID', () => {
    expect(extractShopeeShopId('https://shopee.com.br/Capinha-i.1495837089.58258815395')).toBe(
      '1495837089',
    );
  });

  it('extrai shopId do formato /product/SHOPID/ITEMID', () => {
    expect(extractShopeeShopId('https://shopee.com.br/product/1500679968/58256271370')).toBe(
      '1500679968',
    );
  });

  it('retorna null quando não há shopId', () => {
    expect(extractShopeeShopId('https://shopee.com.br/x')).toBeNull();
  });
});

// ─── extractShopeeSlug ────────────────────────────────────────────────

describe('extractShopeeSlug', () => {
  it('extrai slug antes de -i.', () => {
    expect(extractShopeeSlug('https://shopee.com.br/Capinha-iPhone-i.123.456')).toBe(
      'Capinha-iPhone',
    );
  });

  it('extrai slug de URL sem -i (antiga)', () => {
    expect(extractShopeeSlug('https://shopee.com.br/produto-legal')).toBe('produto-legal');
  });

  it('retorna null quando é /product/ (não é slug de oferta)', () => {
    expect(extractShopeeSlug('https://shopee.com.br/product/1500679968/58256271370')).toBeNull();
  });

  it('retorna null para URL sem domínio shopee', () => {
    expect(extractShopeeSlug('https://outro.com/x')).toBeNull();
  });
});

// ─── extractMlItemId ──────────────────────────────────────────────────

describe('extractMlItemId', () => {
  it('extrai MLB id', () => {
    expect(extractMlItemId('https://www.mercadolivre.com.br/p/MLB-12345678')).toBe('MLB-12345678');
  });

  it('extrai MLU id', () => {
    expect(extractMlItemId('https://www.mercadolivre.com.br/p/MLU-999')).toBe('MLU-999');
  });

  it('extrai MLM id', () => {
    expect(extractMlItemId('https://www.mercadolivre.com.br/p/MLM-999')).toBe('MLM-999');
  });

  it('retorna null quando não há item ML', () => {
    expect(extractMlItemId('https://www.mercadolivre.com.br/social/om895584')).toBeNull();
  });
});

// ─── extractAmazonAsin ────────────────────────────────────────────────

describe('extractAmazonAsin', () => {
  it('extrai ASIN de /dp/', () => {
    expect(extractAmazonAsin('https://www.amazon.com.br/dp/B0GLHZQ64K')).toBe('B0GLHZQ64K');
  });

  it('extrai ASIN de /gp/product/', () => {
    expect(extractAmazonAsin('https://www.amazon.com.br/gp/product/B0ABC12345')).toBe('B0ABC12345');
  });

  it('retorna null quando ASIN não tem 10 chars', () => {
    expect(extractAmazonAsin('https://www.amazon.com.br/dp/B0GL')).toBeNull();
  });

  it('retorna null para URL sem ASIN', () => {
    expect(extractAmazonAsin('https://www.amazon.com.br/s?k=foo')).toBeNull();
  });
});

// ─── ensureHttps ──────────────────────────────────────────────────────

describe('ensureHttps', () => {
  it('mantém https inalterado', () => {
    expect(ensureHttps('https://x.com/a')).toBe('https://x.com/a');
  });

  it('prefixa // com https:', () => {
    expect(ensureHttps('//x.com/a')).toBe('https://x.com/a');
  });

  it('converte http:// para https://', () => {
    expect(ensureHttps('http://x.com/a')).toBe('https://x.com/a');
  });

  it('retorna string sem protocolo inalterada', () => {
    expect(ensureHttps('/images/a.jpg')).toBe('/images/a.jpg');
  });
});

// ─── extractOgImage ───────────────────────────────────────────────────

describe('extractOgImage', () => {
  it('extrai og:image quando property vem antes de content', () => {
    const html = '<meta property="og:image" content="https://x.com/a.jpg">';
    expect(extractOgImage(html)).toBe('https://x.com/a.jpg');
  });

  it('extrai og:image quando content vem antes de property', () => {
    const html = '<meta content="https://x.com/b.jpg" property="og:image">';
    expect(extractOgImage(html)).toBe('https://x.com/b.jpg');
  });

  it('aceita aspas simples', () => {
    const html = "<meta property='og:image' content='https://x.com/c.jpg'>";
    expect(extractOgImage(html)).toBe('https://x.com/c.jpg');
  });

  it('extrai twitter:image', () => {
    const html = '<meta name="twitter:image" content="https://x.com/d.jpg">';
    expect(extractOgImage(html)).toBe('https://x.com/d.jpg');
  });

  it('retorna o primeiro de múltiplas URLs separadas por vírgula', () => {
    const html = '<meta property="og:image" content="https://x.com/a.jpg, https://x.com/b.jpg">';
    expect(extractOgImage(html)).toBe('https://x.com/a.jpg');
  });

  it('aceita URL relativa (/...)', () => {
    const html = '<meta property="og:image" content="/img/a.jpg">';
    expect(extractOgImage(html)).toBe('/img/a.jpg');
  });

  it('retorna null quando não há og:image', () => {
    expect(extractOgImage('<meta property="og:title" content="x">')).toBeNull();
  });

  it('retorna null para html vazio', () => {
    expect(extractOgImage('')).toBeNull();
  });
});

// ─── extractAmazonDynamicImage ────────────────────────────────────────

describe('extractAmazonDynamicImage', () => {
  it('extrai a primeira URL https do data-a-dynamic-image (entities &quot;)', () => {
    const html =
      "data-a-dynamic-image='{&quot;https://m.media-amazon.com/images/I/abc.jpg&quot;:[500,500]}'";
    expect(extractAmazonDynamicImage(html)).toBe('https://m.media-amazon.com/images/I/abc.jpg');
  });

  it('decodifica entidades HTML (&quot; &amp;)', () => {
    const html =
      'data-a-dynamic-image="{&quot;https://m.media-amazon.com/images/I/abc.jpg&amp;x=1&quot;:[500,500]}"';
    expect(extractAmazonDynamicImage(html)).toBe('https://m.media-amazon.com/images/I/abc.jpg&x=1');
  });

  it('retorna null quando não há data-a-dynamic-image', () => {
    expect(extractAmazonDynamicImage('<div>sem imagem</div>')).toBeNull();
  });

  it('retorna null quando o JSON é inválido', () => {
    const html = "data-a-dynamic-image='{ não é json'";
    expect(extractAmazonDynamicImage(html)).toBeNull();
  });

  it('retorna null quando o objeto não tem chaves http(s)', () => {
    const html = 'data-a-dynamic-image=\'{"altura":[1,2]}\'';
    expect(extractAmazonDynamicImage(html)).toBeNull();
  });
});
