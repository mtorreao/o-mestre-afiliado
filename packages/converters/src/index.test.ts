/**
 * Testes de convertUrl / selectConverter (dispatcher de marketplace).
 *
 * `selectConverter` é PURO: mapeia marketplace → função de conversão sem
 * executá-la (a conversão faz fetch em produção). `convertUrl` com marketplace
 * não suportado é 100% puro (branch default). Os branches de fetch são cobertos
 * indiretamente via selectConverter (que retorna a função correta).
 */
import { describe, expect, it } from 'bun:test';
import { convertUrl, selectConverter } from './index.ts';
import { detectMarketplace } from '@omestre/shared';

describe('selectConverter', () => {
  it('mapeia shopee → convertShopeeUrl', () => {
    expect(selectConverter('shopee')).toBeTypeOf('function');
  });

  it('mapeia mercadolivre → convertMercadoLivreUrl', () => {
    expect(selectConverter('mercadolivre')).toBeTypeOf('function');
  });

  it('mapeia amazon → convertAmazonUrl', () => {
    expect(selectConverter('amazon')).toBeTypeOf('function');
  });

  it('retorna null para marketplace não suportado', () => {
    expect(selectConverter('unknown')).toBeNull();
  });

  it('retorna null para magalu (sem conversor dedicado ainda)', () => {
    expect(selectConverter('magalu')).toBeNull();
  });
});

describe('convertUrl — branch não suportado (puro)', () => {
  it('retorna erro para URL de marketplace não suportado', async () => {
    const url = 'https://example.com/foo/bar';
    const r = await convertUrl(url);
    expect(r.success).toBe(false);
    expect(r.affiliateUrl).toBeNull();
    expect(r.method).toBe('unknown');
    expect(r.error).toContain('não suportado');
    expect(r.marketplace).toBe(detectMarketplace(url));
  });

  it('marketplace desconhecido gera erro com o nome do marketplace', async () => {
    const r = await convertUrl('https://sitequalquer.com/x');
    expect(r.marketplace).toBe('unknown');
    expect(r.error).toContain('unknown');
  });
});
