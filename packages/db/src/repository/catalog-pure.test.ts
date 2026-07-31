/**
 * Testes das funções puras do catálogo (catalog-pure.ts) — sem rede,
 * sem banco: parsing/mapeamento de ML/Shopee, normalização de preço,
 * dateTruncHour e construção de variation keys.
 */
import { describe, expect, it } from 'bun:test';
import type { CatalogJob } from '@omestre/shared';
import {
  DEFAULT_VARIATION_SUFFIX,
  buildMlVariations,
  buildProductUpsertFromMl,
  buildProductUpsertFromShopee,
  buildSingleVariationFromShopee,
  buildVariationKey,
  dateTruncHour,
  ensureCatalogFetchResult,
  normalizePrice,
} from './catalog-pure.ts';

const baseJob: CatalogJob = {
  id: 'job-1',
  productKey: 'mercadolivre:MLB12345678',
  marketplace: 'mercadolivre',
  itemId: 'MLB12345678',
  resolvedUrl: 'https://produto.mercadolivre.com.br/MLB-12345678-x',
  sourceGroupJid: '1203630001@g.us',
  messageId: 'msg-1',
  capturedAt: '2026-07-31T14:32:00.000Z',
  userId: null,
};

describe('dateTruncHour', () => {
  it('trunca minutos/segundos para o inicio da hora UTC', () => {
    const d = dateTruncHour(new Date('2026-07-31T14:32:45.123Z'));
    expect(d.toISOString()).toBe('2026-07-31T14:00:00.000Z');
  });

  it('aceita string ISO', () => {
    const d = dateTruncHour('2026-07-31T23:59:59Z');
    expect(d.toISOString()).toBe('2026-07-31T23:00:00.000Z');
  });

  it('nao muta a data de entrada', () => {
    const input = new Date('2026-07-31T14:32:00Z');
    dateTruncHour(input);
    expect(input.toISOString()).toBe('2026-07-31T14:32:00.000Z');
  });

  it('lanca em data invalida', () => {
    expect(() => dateTruncHour('not-a-date')).toThrow('data inválida');
  });
});

describe('normalizePrice', () => {
  it('formata number para numeric(12,2)', () => {
    expect(normalizePrice(199.9)).toBe('199.90');
    expect(normalizePrice(0)).toBe('0.00');
  });

  it('aceita string numerica e string com virgula', () => {
    expect(normalizePrice('199.90')).toBe('199.90');
    expect(normalizePrice('199,90')).toBe('199.90');
  });

  it('retorna null para null/undefined/nao-numerico', () => {
    expect(normalizePrice(null)).toBeNull();
    expect(normalizePrice(undefined)).toBeNull();
    expect(normalizePrice('abc')).toBeNull();
    expect(normalizePrice(Number.NaN)).toBeNull();
  });
});

describe('buildVariationKey', () => {
  it('usa o variationId quando presente', () => {
    expect(buildVariationKey('shopee:1', '123')).toBe('shopee:1:123');
  });

  it('usa o sufixo :default quando variationId e null', () => {
    expect(buildVariationKey('shopee:1', null)).toBe('shopee:1:' + DEFAULT_VARIATION_SUFFIX);
    expect(DEFAULT_VARIATION_SUFFIX).toBe('default');
  });
});

describe('buildProductUpsertFromMl', () => {
  it('mapeia title (trim) e imagem secure_url', () => {
    const row = buildProductUpsertFromMl(baseJob, {
      title: '  Tenis Nike  ',
      pictures: [{ url: 'http://plain', secure_url: 'https://secure' }],
    });
    expect(row.title).toBe('Tenis Nike');
    expect(row.imageUrl).toBe('https://secure');
    expect(row.marketplace).toBe('mercadolivre');
    expect(row.productKey).toBe('mercadolivre:MLB12345678');
  });

  it('cai para url quando nao ha secure_url e null sem pictures', () => {
    const rowUrl = buildProductUpsertFromMl(baseJob, {
      pictures: [{ url: 'http://plain' }],
    });
    expect(rowUrl.imageUrl).toBe('http://plain');

    const rowNull = buildProductUpsertFromMl(baseJob, {});
    expect(rowNull.imageUrl).toBeNull();
    expect(rowNull.title).toBeNull();
  });
});

describe('buildMlVariations — variações reais', () => {
  const capturedAt = new Date('2026-07-31T14:32:00Z');

  it('mapeia cada variação com key/name/attrs/price/stock', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      {
        variations: [
          {
            id: 101,
            price: 199.9,
            original_price: 249.9,
            available_quantity: 7,
            attribute_combinations: [
              { name: 'Cor', value_name: 'Azul' },
              { name: 'Tamanho', value_name: 'M' },
            ],
          },
        ],
      },
      capturedAt,
      baseJob.sourceGroupJid,
      baseJob.messageId,
    );

    expect(result).toHaveLength(1);
    const v = result[0]!;
    expect(v.row.variationKey).toBe('mercadolivre:MLB12345678:101');
    expect(v.row.variationId).toBe('101');
    expect(v.row.variationName).toBe('Azul / M');
    expect(v.row.attributesJson).toEqual({ Cor: 'Azul', Tamanho: 'M' });
    expect(v.price.price).toBe('199.90');
    expect(v.price.listPrice).toBe('249.90');
    expect(v.price.currency).toBe('BRL');
    expect(v.price.available).toBe(true);
    expect(v.price.stock).toBe(7);
    expect(v.price.priceBucket.toISOString()).toBe('2026-07-31T14:00:00.000Z');
    expect(v.price.capturedAt).toBe(capturedAt);
    expect(v.price.source).toBe('background');
    expect(v.price.sourceGroupJid).toBe(baseJob.sourceGroupJid);
    expect(v.price.messageId).toBe(baseJob.messageId);
  });

  it('available=false quando available_quantity = 0', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      { variations: [{ id: 1, price: 10, available_quantity: 0 }] },
      capturedAt,
      null,
      null,
    );
    expect(result[0]?.price.available).toBe(false);
    expect(result[0]?.price.stock).toBe(0);
    expect(result[0]?.price.sourceGroupJid).toBeNull();
  });

  it('available=true quando available_quantity ausente (stock null)', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      { variations: [{ id: 1, price: 10 }] },
      capturedAt,
      null,
      null,
    );
    expect(result[0]?.price.available).toBe(true);
    expect(result[0]?.price.stock).toBeNull();
  });

  it('ignora variação sem price (nao invalida o job)', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      {
        variations: [
          { id: 1, price: null },
          { id: 2, price: 50 },
        ],
      },
      capturedAt,
      null,
      null,
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.row.variationKey).toBe('mercadolivre:MLB12345678:2');
  });

  it('variationName null quando sem attribute_combinations', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      { variations: [{ id: 1, price: 10 }] },
      capturedAt,
      null,
      null,
    );
    expect(result[0]?.row.variationName).toBeNull();
    expect(result[0]?.row.attributesJson).toEqual({});
  });

  it('variationId string vinda de id numerico ou string', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      { variations: [{ id: 'ABC', price: 10 }] },
      capturedAt,
      null,
      null,
    );
    expect(result[0]?.row.variationId).toBe('ABC');
  });
});

describe('buildMlVariations — variação implícita :default', () => {
  const capturedAt = new Date('2026-07-31T14:32:00Z');

  it('gera UMA variação :default com price do item raiz', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      { price: 99.9, original_price: 129.9, available_quantity: 3 },
      capturedAt,
      baseJob.sourceGroupJid,
      baseJob.messageId,
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.row.variationKey).toBe('mercadolivre:MLB12345678:default');
    expect(result[0]?.row.variationId).toBeNull();
    expect(result[0]?.row.variationName).toBeNull();
    expect(result[0]?.price.price).toBe('99.90');
    expect(result[0]?.price.listPrice).toBe('129.90');
    expect(result[0]?.price.available).toBe(true);
  });

  it('retorna [] quando o item raiz nao tem price (sem dado util)', () => {
    const result = buildMlVariations(baseJob.productKey, {}, capturedAt, null, null);
    expect(result).toEqual([]);
  });

  it('available=false com available_quantity 0 no item raiz', () => {
    const result = buildMlVariations(
      baseJob.productKey,
      { price: 10, available_quantity: 0 },
      capturedAt,
      null,
      null,
    );
    expect(result[0]?.price.available).toBe(false);
  });
});

describe('buildProductUpsertFromShopee + buildSingleVariationFromShopee', () => {
  const capturedAt = new Date('2026-07-31T14:32:00Z');
  const shopeeJob: CatalogJob = {
    ...baseJob,
    marketplace: 'shopee',
    productKey: 'shopee:22298230083',
    itemId: '22298230083',
  };

  it('mapeia title/image do offer', () => {
    const row = buildProductUpsertFromShopee(shopeeJob, {
      productName: '  Mouse Gamer  ',
      imageUrl: 'https://img.shopee/1.jpg',
    });
    expect(row.title).toBe('Mouse Gamer');
    expect(row.imageUrl).toBe('https://img.shopee/1.jpg');
    expect(row.marketplace).toBe('shopee');
    expect(row.productKey).toBe('shopee:22298230083');
  });

  it('monta variação :default com price preferido', () => {
    const v = buildSingleVariationFromShopee(
      shopeeJob.productKey,
      { price: 89.9 },
      capturedAt,
      shopeeJob.sourceGroupJid,
      shopeeJob.messageId,
    );
    expect(v).not.toBeNull();
    expect(v!.row.variationKey).toBe('shopee:22298230083:default');
    expect(v!.price.price).toBe('89.90');
    expect(v!.price.listPrice).toBeNull();
    expect(v!.price.available).toBe(true);
    expect(v!.price.stock).toBeNull();
    expect(v!.price.priceBucket.toISOString()).toBe('2026-07-31T14:00:00.000Z');
  });

  it('fallback para priceMin e priceMax', () => {
    const min = buildSingleVariationFromShopee(
      shopeeJob.productKey,
      { priceMin: '50.5' },
      capturedAt,
      null,
      null,
    );
    expect(min!.price.price).toBe('50.50');
    const max = buildSingleVariationFromShopee(
      shopeeJob.productKey,
      { priceMax: 60 },
      capturedAt,
      null,
      null,
    );
    expect(max!.price.price).toBe('60.00');
  });

  it('retorna null sem nenhum price', () => {
    const v = buildSingleVariationFromShopee(shopeeJob.productKey, {}, capturedAt, null, null);
    expect(v).toBeNull();
  });
});

describe('ensureCatalogFetchResult', () => {
  it('retorna null quando nao ha variacao com preco', () => {
    expect(
      ensureCatalogFetchResult(
        { marketplace: 'shopee', itemId: '1', productKey: 'shopee:1', title: null, imageUrl: null },
        [],
      ),
    ).toBeNull();
  });

  it('retorna o resultado quando ha ao menos 1 variacao', () => {
    const product = {
      marketplace: 'shopee' as const,
      itemId: '1',
      productKey: 'shopee:1',
      title: null,
      imageUrl: null,
    };
    const v = {
      row: {
        variationKey: 'shopee:1:default',
        variationId: null,
        variationName: null,
        attributesJson: {},
      },
      price: {
        price: '10.00',
        listPrice: null,
        currency: 'BRL',
        available: true,
        stock: null,
        priceBucket: new Date(),
        capturedAt: new Date(),
        source: 'background' as const,
        sourceGroupJid: null,
        messageId: null,
      },
    };
    const result = ensureCatalogFetchResult(product, [v]);
    expect(result).not.toBeNull();
    expect(result!.variations).toHaveLength(1);
  });
});
