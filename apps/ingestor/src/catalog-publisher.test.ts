/**
 * Testes do catalog-publisher (Queue C).
 *
 * `resolveCatalogTarget` é pura (parse de URL, sem rede). `publishCatalogJob`
 * usa Redis injetado (fake) — nenhuma conexão real nos testes.
 */
import { describe, expect, it } from 'bun:test';
import type Redis from 'ioredis';
import { MIRROR_CATALOG_STREAM } from '@omestre/shared';
import type { CatalogJob } from '@omestre/shared';
import {
  CATALOG_STREAM_MAXLEN,
  publishCatalogJob,
  resolveCatalogTarget,
} from './catalog-publisher.ts';

describe('resolveCatalogTarget', () => {
  describe('shopee', () => {
    it('extrai itemId do formato canônico -i.<shop>.<item>', () => {
      expect(
        resolveCatalogTarget('shopee', 'https://shopee.com.br/Capinha-i.123.456789012'),
      ).toEqual({
        marketplace: 'shopee',
        itemId: '456789012',
        productKey: 'shopee:456789012',
      });
    });

    it('extrai itemId do formato /product/<shop>/<item>', () => {
      expect(
        resolveCatalogTarget('shopee', 'https://shopee.com.br/product/123456/456789012'),
      ).toEqual({
        marketplace: 'shopee',
        itemId: '456789012',
        productKey: 'shopee:456789012',
      });
    });

    it('retorna null quando não há itemId', () => {
      expect(resolveCatalogTarget('shopee', 'https://shopee.com.br/shop/123456')).toBeNull();
    });
  });

  describe('mercadolivre', () => {
    it('extrai MLB da URL de produto', () => {
      expect(
        resolveCatalogTarget('mercadolivre', 'https://www.mercadolivre.com.br/MLB12345678901'),
      ).toEqual({
        marketplace: 'mercadolivre',
        itemId: 'MLB12345678901',
        productKey: 'mercadolivre:MLB12345678901',
      });
    });

    it('extrai MLM de URL /p/', () => {
      expect(
        resolveCatalogTarget('mercadolivre', 'https://www.mercadolivre.com.mx/p/MLM12345678'),
      ).toEqual({
        marketplace: 'mercadolivre',
        itemId: 'MLM12345678',
        productKey: 'mercadolivre:MLM12345678',
      });
    });

    it('normaliza itemId em minúsculas para maiúsculas', () => {
      expect(
        resolveCatalogTarget('mercadolivre', 'https://www.mercadolivre.com.br/mlb9876543210'),
      ).toEqual({
        marketplace: 'mercadolivre',
        itemId: 'MLB9876543210',
        productKey: 'mercadolivre:MLB9876543210',
      });
    });

    it('retorna null sem itemId válido (prefixo sem dígitos suficientes)', () => {
      expect(
        resolveCatalogTarget('mercadolivre', 'https://www.mercadolivre.com.br/p/MLB123'),
      ).toBeNull();
    });
  });

  describe('amazon', () => {
    it('extrai ASIN de /dp/ (normaliza maiúsculas)', () => {
      expect(resolveCatalogTarget('amazon', 'https://www.amazon.com.br/dp/b07pxgqck5')).toEqual({
        marketplace: 'amazon',
        itemId: 'B07PXGQCK5',
        productKey: 'amazon:B07PXGQCK5',
      });
    });

    it('retorna null sem /dp/', () => {
      expect(
        resolveCatalogTarget('amazon', 'https://www.amazon.com.br/s?k=fone+bluetooth'),
      ).toBeNull();
    });
  });

  describe('outros marketplaces', () => {
    it('magalu/unknown → null (não normalizável, não publica)', () => {
      expect(resolveCatalogTarget('magalu', 'https://www.magazineluiza.com.br/x/p/abc')).toBeNull();
      expect(resolveCatalogTarget('unknown', 'https://example.com/x')).toBeNull();
    });
  });
});

describe('publishCatalogJob', () => {
  it('publica CatalogJob completo na Queue C (XADD MAXLEN ~ 50k)', async () => {
    const calls: Array<{ stream: string; args: unknown[] }> = [];
    const redis = {
      xadd: async (...args: unknown[]) => {
        calls.push({ stream: String(args[0]), args });
        return '1720000000000-0';
      },
    } as unknown as Redis;

    const published = await publishCatalogJob(
      {
        id: 'job-1',
        marketplace: 'shopee',
        resolvedUrl: 'https://shopee.com.br/Capinha-i.123.456',
        sourceGroupJid: '1203630000@g.us',
        messageId: 'msg-42',
        userId: 7,
        capturedAt: '2026-07-31T12:00:00.000Z',
      },
      redis,
    );

    expect(published).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.stream).toBe(MIRROR_CATALOG_STREAM);
    expect(calls[0]?.args).toEqual([
      MIRROR_CATALOG_STREAM,
      'MAXLEN',
      '~',
      CATALOG_STREAM_MAXLEN,
      '*',
      'payload',
      expect.any(String),
    ]);

    const payload = JSON.parse(String(calls[0]!.args[6])) as CatalogJob;
    expect(payload).toEqual({
      id: 'job-1',
      productKey: 'shopee:456',
      marketplace: 'shopee',
      itemId: '456',
      resolvedUrl: 'https://shopee.com.br/Capinha-i.123.456',
      sourceGroupJid: '1203630000@g.us',
      messageId: 'msg-42',
      capturedAt: '2026-07-31T12:00:00.000Z',
      userId: 7,
    });
  });

  it('gera id UUID e capturedAt ISO por padrão (userId ausente → null)', async () => {
    let payload = '';
    const redis = {
      xadd: async (...args: unknown[]) => {
        payload = String(args[6]);
        return '1-0';
      },
    } as unknown as Redis;

    await publishCatalogJob(
      {
        marketplace: 'amazon',
        resolvedUrl: 'https://www.amazon.com.br/dp/B07PXGQCK5',
        sourceGroupJid: 'g',
        messageId: 'm',
      },
      redis,
    );

    const job = JSON.parse(payload) as CatalogJob;
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Number.isNaN(Date.parse(job.capturedAt))).toBe(false);
    expect(job.userId).toBeNull();
    expect(job.productKey).toBe('amazon:B07PXGQCK5');
  });

  it('itemId não resolvível → NÃO publica (retorna false, sem XADD)', async () => {
    let xaddCalled = false;
    const redis = {
      xadd: async () => {
        xaddCalled = true;
        return '1-0';
      },
    } as unknown as Redis;

    const published = await publishCatalogJob(
      {
        marketplace: 'magalu',
        resolvedUrl: 'https://www.magazineluiza.com.br/x/p/abc',
        sourceGroupJid: 'g',
        messageId: 'm',
      },
      redis,
    );

    expect(published).toBe(false);
    expect(xaddCalled).toBe(false);
  });

  it('redis null → não publica (fail-open)', async () => {
    const published = await publishCatalogJob(
      {
        marketplace: 'shopee',
        resolvedUrl: 'https://shopee.com.br/Capinha-i.123.456',
        sourceGroupJid: 'g',
        messageId: 'm',
      },
      null,
    );
    expect(published).toBe(false);
  });

  it('falha no XADD → propaga rejeição (caller loga warn, espelhamento não quebra)', async () => {
    const redis = {
      xadd: async () => {
        throw new Error('connection refused');
      },
    } as unknown as Redis;

    await expect(
      publishCatalogJob(
        {
          marketplace: 'shopee',
          resolvedUrl: 'https://shopee.com.br/Capinha-i.123.456',
          sourceGroupJid: 'g',
          messageId: 'm',
        },
        redis,
      ),
    ).rejects.toThrow('connection refused');
  });
});
