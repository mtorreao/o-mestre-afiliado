/**
 * Testes das funções PURAS NOVAS em apps/ingestor/src/product-image-pure.ts.
 *
 * As funções pré-existentes (extractShopeeItemId, extractOgImage, etc.) já
 * são cobertas por product-image-pure.test.ts via re-export de
 * product-image.ts. Este arquivo cobre as funções extraídas na rodada 3:
 * cache payload/parse, toAbsolute, extractAnyProductImage, builders de
 * URL de CDN/API, isImageContentType e o log entry determinístico.
 */
import { describe, expect, it } from 'bun:test';
import {
  parseCachedImage,
  buildCachedImagePayload,
  toAbsolute,
  extractAnyProductImage,
  buildShopeeCdnCandidates,
  buildAmazonCdnCandidates,
  buildMlItemApiUrl,
  buildAmazonDpUrl,
  extractMlApiImage,
  isImageContentType,
  buildImageStrategyLogEntry,
} from './product-image-pure.ts';

// ─── parseCachedImage / buildCachedImagePayload ────────────────────────

describe('parseCachedImage', () => {
  it('parseia payload válido', () => {
    expect(parseCachedImage('{"imageUrl":"https://a/b.jpg","fetchedAt":"2026-01-01"}')).toEqual({
      imageUrl: 'https://a/b.jpg',
      fetchedAt: '2026-01-01',
    });
  });

  it('retorna null para raw ausente', () => {
    expect(parseCachedImage(null)).toBeNull();
    expect(parseCachedImage(undefined)).toBeNull();
    expect(parseCachedImage('')).toBeNull();
  });

  it('retorna null para JSON inválido', () => {
    expect(parseCachedImage('not-json{')).toBeNull();
  });
});

describe('buildCachedImagePayload', () => {
  it('serializa imageUrl + fetchedAt injetado (determinístico)', () => {
    const payload = buildCachedImagePayload('https://img/x.jpg', '2026-07-27T00:00:00.000Z');
    expect(JSON.parse(payload)).toEqual({
      imageUrl: 'https://img/x.jpg',
      fetchedAt: '2026-07-27T00:00:00.000Z',
    });
  });

  it('aceita imageUrl null (cache negativo)', () => {
    expect(JSON.parse(buildCachedImagePayload(null, 't'))).toEqual({
      imageUrl: null,
      fetchedAt: 't',
    });
  });

  it('roundtrip com parseCachedImage', () => {
    const raw = buildCachedImagePayload('https://a/b.png', '2026-01-02');
    expect(parseCachedImage(raw)).toEqual({ imageUrl: 'https://a/b.png', fetchedAt: '2026-01-02' });
  });
});

// ─── toAbsolute ────────────────────────────────────────────────────────

describe('toAbsolute', () => {
  it('resolve URL relativa contra a base', () => {
    expect(toAbsolute('/img/a.jpg', 'https://site.com/page')).toBe('https://site.com/img/a.jpg');
  });

  it('mantém URL absoluta', () => {
    expect(toAbsolute('https://cdn.com/x.jpg', 'https://site.com/')).toBe('https://cdn.com/x.jpg');
  });

  it('retorna a original quando base inválida', () => {
    expect(toAbsolute('caminho-relativo', 'base-invalida')).toBe('caminho-relativo');
  });
});

// ─── extractAnyProductImage ────────────────────────────────────────────

describe('extractAnyProductImage', () => {
  it('prioriza og:image sobre data-a-dynamic-image', () => {
    const html = `
      <meta property="og:image" content="https://og.com/img.jpg">
      <img data-a-dynamic-image='{&quot;https://amz.com/a.jpg&quot;:[500,500]}'>
    `;
    expect(extractAnyProductImage(html, 'https://site.com/')).toBe('https://og.com/img.jpg');
  });

  it('cai para data-a-dynamic-image quando não há og:image', () => {
    const html = `<img data-a-dynamic-image='{&quot;https://amz.com/a.jpg&quot;:[500,500]}'>`;
    expect(extractAnyProductImage(html, 'https://site.com/')).toBe('https://amz.com/a.jpg');
  });

  it('resolve og:image relativa contra a base', () => {
    const html = `<meta property="og:image" content="/rel/img.png">`;
    expect(extractAnyProductImage(html, 'https://site.com/page')).toBe(
      'https://site.com/rel/img.png',
    );
  });

  it('retorna null quando não há imagem', () => {
    expect(extractAnyProductImage('<html><body>vazio</body></html>', 'https://x.com/')).toBeNull();
  });
});

// ─── Builders de URL ───────────────────────────────────────────────────

describe('buildShopeeCdnCandidates', () => {
  it('monta os dois candidatos com itemId', () => {
    expect(buildShopeeCdnCandidates('456')).toEqual([
      'https://cf.shopee.com.br/file/456_tn',
      'https://down-br.img.susercontent.com/file-456_tn',
    ]);
  });
});

describe('buildAmazonCdnCandidates', () => {
  it('monta os quatro candidatos com ASIN', () => {
    const c = buildAmazonCdnCandidates('B0ABCDEF12');
    expect(c).toHaveLength(4);
    expect(c[0]).toBe('https://m.media-amazon.com/images/P/B0ABCDEF12.01._SCRM_.jpg');
    expect(c[1]).toBe('https://images-na.ssl-images-amazon.com/images/P/B0ABCDEF12.01._SCRM_.jpg');
    expect(c[2]).toBe(
      'https://images-na.ssl-images-amazon.com/images/P/B0ABCDEF12.01._AC_SCRM_.jpg',
    );
    expect(c[3]).toBe(
      'https://images-na.ssl-images-amazon.com/images/P/B0ABCDEF12.01.LZZZZZZZ.jpg',
    );
  });
});

describe('buildMlItemApiUrl / buildAmazonDpUrl', () => {
  it('monta URL da API pública do ML', () => {
    expect(buildMlItemApiUrl('MLB-123')).toBe('https://api.mercadolibre.com/items/MLB-123');
  });

  it('monta URL /dp/{ASIN} da Amazon BR', () => {
    expect(buildAmazonDpUrl('B0ABCDEF12')).toBe('https://www.amazon.com.br/dp/B0ABCDEF12');
  });
});

// ─── extractMlApiImage ─────────────────────────────────────────────────

describe('extractMlApiImage', () => {
  it('extrai a primeira picture', () => {
    expect(
      extractMlApiImage({ pictures: [{ url: 'https://ml/1.jpg' }, { url: 'https://ml/2.jpg' }] }),
    ).toBe('https://ml/1.jpg');
  });

  it('retorna null para payload sem pictures / vazio / null', () => {
    expect(extractMlApiImage({})).toBeNull();
    expect(extractMlApiImage({ pictures: [] })).toBeNull();
    expect(extractMlApiImage(null)).toBeNull();
    expect(extractMlApiImage(undefined)).toBeNull();
  });
});

// ─── isImageContentType ────────────────────────────────────────────────

describe('isImageContentType', () => {
  it('aceita image/*', () => {
    expect(isImageContentType('image/jpeg')).toBe(true);
    expect(isImageContentType('image/png; charset=binary')).toBe(true);
  });

  it('rejeita não-imagem / vazio / null', () => {
    expect(isImageContentType('text/html')).toBe(false);
    expect(isImageContentType('')).toBe(false);
    expect(isImageContentType(null)).toBe(false);
    expect(isImageContentType(undefined)).toBe(false);
  });
});

// ─── buildImageStrategyLogEntry ────────────────────────────────────────

describe('buildImageStrategyLogEntry', () => {
  const ts = '2026-07-27T12:00:00.000Z';

  it('entry de sucesso (level info, com imageUrl e strategy)', () => {
    expect(
      buildImageStrategyLogEntry('shopee', 'cdn_direct', 'https://p/url', 'https://img/x', ts),
    ).toEqual({
      timestamp: ts,
      level: 'info',
      service: 'product-image',
      message: 'Imagem encontrada (cdn_direct)',
      marketplace: 'shopee',
      productUrl: 'https://p/url',
      imageUrl: 'https://img/x',
      strategy: 'cdn_direct',
    });
  });

  it('entry de falha (level debug, sem imageUrl/strategy)', () => {
    expect(buildImageStrategyLogEntry('amazon', 'og_image', 'https://p/url', null, ts)).toEqual({
      timestamp: ts,
      level: 'debug',
      service: 'product-image',
      message: 'Estratégia og_image falhou',
      marketplace: 'amazon',
      productUrl: 'https://p/url',
    });
  });
});
