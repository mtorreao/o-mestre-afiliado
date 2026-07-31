/**
 * Testes do CatalogRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * insert().values().onConflictDoUpdate().returning() e
 * insert().values().onConflictDoNothing().returning() encadeáveis,
 * capturando os payloads para asserção — suficiente para testar o
 * mapeamento de linhas e a sequência de upserts sem conexão externa.
 * Padrão: mirrors.repository.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type {
  CatalogFetchResult,
  PriceHistoryRow,
  ProductUpsertRow,
  VariationUpsertRow,
} from './catalog-pure.ts';

interface CapturedInsert {
  values: unknown;
  set?: unknown;
  target?: unknown;
}

/**
 * Fake Drizzle client. `over` permite trocar comportamentos pontuais;
 * `capture` recebe cada insert para asserção dos payloads.
 */
function fakeDb(
  capture: CapturedInsert[],
  over: { returningOnConflict?: Array<{ id: number }> } = {
    returningOnConflict: [{ id: 1 }],
  },
): { insert: (table: unknown) => unknown } {
  return {
    insert: (_table: unknown) => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: (conf: { target: unknown; set: unknown }) => ({
          returning: () => {
            capture.push({ values: v, set: conf.set, target: conf.target });
            return Promise.resolve([{ id: 1 }]);
          },
        }),
        onConflictDoNothing: () => ({
          returning: () => {
            capture.push({ values: v, set: null, target: null });
            return Promise.resolve(over.returningOnConflict ?? []);
          },
        }),
      }),
    }),
  };
}

// Mock getDb ANTES de importar o CatalogRepository
await mock.module('../db.ts', () => ({
  getDb: () => fakeDb([]),
}));

const { CatalogRepository } = await import('./catalog.repository.ts');

function newCapture(): CapturedInsert[] {
  const arr: CapturedInsert[] = [];
  mock.module('../db.ts', () => ({
    getDb: () => fakeDb(arr),
  }));
  return arr;
}

describe('CatalogRepository', () => {
  beforeEach(() => {
    mock.module('../db.ts', () => ({
      getDb: () => fakeDb([]),
    }));
  });

  afterEach(() => {
    mock.module('../db.ts', () => ({
      getDb: () => fakeDb([]),
    }));
  });

  describe('upsertProduct', () => {
    it('insere com os campos mapeados e retorna o id', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      const row: ProductUpsertRow = {
        marketplace: 'mercadolivre',
        itemId: 'MLB12345678',
        productKey: 'mercadolivre:MLB12345678',
        title: 'Tenis Nike',
        imageUrl: 'https://img.example/nike.jpg',
      };

      const id = await repo.upsertProduct(row);
      expect(id).toBe(1);

      expect(capture).toHaveLength(1);
      const values = capture[0]?.values as Record<string, unknown>;
      expect(values['marketplace']).toBe('mercadolivre');
      expect(values['marketplaceItemId']).toBe('MLB12345678');
      expect(values['productKey']).toBe('mercadolivre:MLB12345678');
      expect(values['title']).toBe('Tenis Nike');
      expect(values['imageUrl']).toBe('https://img.example/nike.jpg');
    });

    it('titulo/imagem nulos sao persistidos como null', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      const row: ProductUpsertRow = {
        marketplace: 'shopee',
        itemId: '22298230083',
        productKey: 'shopee:22298230083',
        title: null,
        imageUrl: null,
      };

      await repo.upsertProduct(row);
      const values = capture[0]?.values as Record<string, unknown>;
      expect(values['title']).toBeNull();
      expect(values['imageUrl']).toBeNull();
    });

    it('ON CONFLICT faz DO UPDATE em title/image_url/last_seen_at', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      await repo.upsertProduct({
        marketplace: 'amazon',
        itemId: 'B0EXAMPLE00',
        productKey: 'amazon:B0EXAMPLE00',
        title: 'Kindle',
        imageUrl: null,
      });

      const set = capture[0]?.set as Record<string, unknown>;
      expect(set['title']).toBe('Kindle');
      expect(set['imageUrl']).toBeNull();
      expect(set['lastSeenAt']).toBeInstanceOf(Date);
      expect(capture[0]?.target).toBeDefined();
    });

    it('lanca quando returning() vem vazio', async () => {
      mock.module('../db.ts', () => ({
        getDb: () => ({
          insert: () => ({
            values: () => ({
              onConflictDoUpdate: () => ({
                returning: () => Promise.resolve([]),
              }),
              onConflictDoNothing: () => ({
                returning: () => Promise.resolve([]),
              }),
            }),
          }),
        }),
      }));
      const repo = new CatalogRepository();
      await expect(
        repo.upsertProduct({
          marketplace: 'shopee',
          itemId: '1',
          productKey: 'shopee:1',
          title: null,
          imageUrl: null,
        }),
      ).rejects.toThrow('returning() vazio');
    });
  });

  describe('upsertVariation', () => {
    it('insere com productId + variationKey + atributos', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      const row: VariationUpsertRow = {
        variationKey: 'mercadolivre:MLB1:123',
        variationId: '123',
        variationName: 'Azul / M',
        attributesJson: { Cor: 'Azul', Tamanho: 'M' },
      };

      const id = await repo.upsertVariation(42, row);
      expect(id).toBe(1);

      const values = capture[0]?.values as Record<string, unknown>;
      expect(values['productId']).toBe(42);
      expect(values['variationKey']).toBe('mercadolivre:MLB1:123');
      expect(values['variationId']).toBe('123');
      expect(values['variationName']).toBe('Azul / M');
      expect(values['attributesJson']).toEqual({ Cor: 'Azul', Tamanho: 'M' });
    });

    it('ON CONFLICT atualiza name/id/attributes e last_seen_at', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      await repo.upsertVariation(7, {
        variationKey: 'shopee:1:default',
        variationId: null,
        variationName: null,
        attributesJson: {},
      });

      const set = capture[0]?.set as Record<string, unknown>;
      expect(set['variationName']).toBeNull();
      expect(set['lastSeenAt']).toBeInstanceOf(Date);
    });
  });

  describe('appendPriceHistory', () => {
    const baseRow: PriceHistoryRow = {
      variationId: 99,
      price: '199.90',
      listPrice: '249.90',
      currency: 'BRL',
      available: true,
      stock: 12,
      priceBucket: new Date('2026-07-31T14:00:00Z'),
      capturedAt: new Date('2026-07-31T14:32:00Z'),
      source: 'background',
      sourceGroupJid: 'group@g.us',
      messageId: 'msg-1',
    };

    it('retorna true quando o ponto de preco foi inserido', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      const inserted = await repo.appendPriceHistory(baseRow);
      expect(inserted).toBe(true);

      const values = capture[0]?.values as Record<string, unknown>;
      expect(values['variationId']).toBe(99);
      expect(values['price']).toBe('199.90');
      expect(values['listPrice']).toBe('249.90');
      expect(values['currency']).toBe('BRL');
      expect(values['available']).toBe(true);
      expect(values['stock']).toBe(12);
      expect(values['priceBucket']).toEqual(new Date('2026-07-31T14:00:00Z'));
      expect(values['capturedAt']).toEqual(new Date('2026-07-31T14:32:00Z'));
      expect(values['source']).toBe('background');
      expect(values['sourceGroupJid']).toBe('group@g.us');
      expect(values['messageId']).toBe('msg-1');
    });

    it('retorna false quando ON CONFLICT DO NOTHING (dedup 1h)', async () => {
      const capture = newCapture();
      mock.module('../db.ts', () => ({
        getDb: () => fakeDb(capture, { returningOnConflict: [] }),
      }));
      const repo = new CatalogRepository();

      const inserted = await repo.appendPriceHistory(baseRow);
      expect(inserted).toBe(false);
    });

    it('listPrice/stock nulos sao persistidos como null', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      await repo.appendPriceHistory({ ...baseRow, listPrice: null, stock: null });
      const values = capture[0]?.values as Record<string, unknown>;
      expect(values['listPrice']).toBeNull();
      expect(values['stock']).toBeNull();
    });
  });

  describe('upsertCatalog', () => {
    const fetchResult: CatalogFetchResult = {
      product: {
        marketplace: 'mercadolivre',
        itemId: 'MLB1',
        productKey: 'mercadolivre:MLB1',
        title: 'Produto',
        imageUrl: null,
      },
      variations: [
        {
          row: {
            variationKey: 'mercadolivre:MLB1:1',
            variationId: '1',
            variationName: 'Azul',
            attributesJson: { Cor: 'Azul' },
          },
          price: {
            price: '100.00',
            listPrice: null,
            currency: 'BRL',
            available: true,
            stock: 5,
            priceBucket: new Date('2026-07-31T14:00:00Z'),
            capturedAt: new Date('2026-07-31T14:10:00Z'),
            source: 'background',
            sourceGroupJid: 'g@g.us',
            messageId: 'm1',
          },
        },
      ],
    };

    it('encadeia product + variation + price_history e conta insercoes', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      const result = await repo.upsertCatalog(fetchResult);
      expect(result.productId).toBe(1);
      expect(result.variationIds).toEqual([1]);
      expect(result.insertedHistory).toBe(1);
      expect(capture).toHaveLength(3); // 1 product + 1 variation + 1 price
      const priceValues = capture[2]?.values as Record<string, unknown>;
      expect(priceValues['variationId']).toBe(1); // variationId resolvido
    });

    it('insertedHistory = 0 quando o dedup bloqueia todos os pontos', async () => {
      const capture = newCapture();
      mock.module('../db.ts', () => ({
        getDb: () => fakeDb(capture, { returningOnConflict: [] }),
      }));
      const repo = new CatalogRepository();

      const result = await repo.upsertCatalog(fetchResult);
      expect(result.productId).toBe(1);
      expect(result.variationIds).toEqual([1]);
      expect(result.insertedHistory).toBe(0);
    });

    it('grava multiplas variacoes do ML', async () => {
      const capture = newCapture();
      const repo = new CatalogRepository();

      const multi: CatalogFetchResult = {
        ...fetchResult,
        variations: [
          ...fetchResult.variations,
          {
            row: {
              variationKey: 'mercadolivre:MLB1:2',
              variationId: '2',
              variationName: 'Preto',
              attributesJson: { Cor: 'Preto' },
            },
            price: {
              price: '110.00',
              listPrice: '120.00',
              currency: 'BRL',
              available: false,
              stock: 0,
              priceBucket: new Date('2026-07-31T14:00:00Z'),
              capturedAt: new Date('2026-07-31T14:10:00Z'),
              source: 'background',
              sourceGroupJid: 'g@g.us',
              messageId: 'm1',
            },
          },
        ],
      };

      const result = await repo.upsertCatalog(multi);
      expect(result.variationIds).toEqual([1, 1]); // fake retorna sempre id 1
      expect(result.insertedHistory).toBe(2);
      expect(capture).toHaveLength(5); // 1 product + 2 variations + 2 prices
    });
  });
});
