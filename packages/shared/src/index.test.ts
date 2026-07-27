/**
 * Testes do @omestre/shared — funções puras de index.ts.
 *
 * Cobre:
 *  - detectMarketplace: padrões de domínios
 *  - MARKETPLACE_NAMES: dicionário PT-BR
 *  - KNOWN_PLACEHOLDERS: conjunto de placeholders reconhecidos
 *  - resolvePlaceholders: substituição de placeholders simples
 *  - findUnknownPlaceholders: extração de placeholders não reconhecidos
 *
 * template-parser.ts já tem cobertura em
 * packages/shared/src/__tests__/template-parser.test.ts.
 */
import { describe, expect, it } from 'bun:test';
import {
  detectMarketplace,
  MARKETPLACE_NAMES,
  KNOWN_PLACEHOLDERS,
  resolvePlaceholders,
  findUnknownPlaceholders,
  type TemplateContext,
} from './index.ts';

const baseCtx: TemplateContext = {
  originalText: 'Oferta incrível: {link_original}',
  originalUrl: 'https://shopee.com.br/product-xyz',
  convertedUrl: 'https://shp.ee/abc',
  marketplace: 'shopee',
  sourceGroupName: 'Grupo Origem',
  targetGroupName: 'Grupo Destino',
  timestamp: new Date(2026, 6, 27, 14, 30), // 27/07/2026 14:30
};

describe('detectMarketplace', () => {
  describe('shopee', () => {
    it.each([
      'https://shopee.com.br/product-xyz',
      'https://www.shopee.com.br/product-xyz',
      'https://shopee.com/product-xyz',
      'https://s.shopee.com.br/abc',
      'https://go.promozone.ai/shopee/x',
      'https://go.promozone.ai/shp/x',
    ])('detecta "%s"', (url) => {
      expect(detectMarketplace(url)).toBe('shopee');
    });
  });

  describe('mercadolivre', () => {
    it.each([
      'https://www.mercadolivre.com.br/produto',
      'https://produto.mercadolivre.com.br/MLB-123',
      'https://www.mercadolibre.com.ar/produto',
      'https://meli.la/abc',
      'https://go.promozone.ai/mercadolivre/x',
      'https://go.promozone.ai/ml/x',
    ])('detecta "%s"', (url) => {
      expect(detectMarketplace(url)).toBe('mercadolivre');
    });
  });

  describe('amazon', () => {
    it.each([
      'https://www.amazon.com.br/dp/B07PXGQCK5',
      'https://www.amazon.com/dp/B07PXGQCK5',
      'https://amzn.to/abc123',
      'https://go.promozone.ai/amazon/B07PXGQCK5',
    ])('detecta "%s"', (url) => {
      expect(detectMarketplace(url)).toBe('amazon');
    });
  });

  describe('magalu', () => {
    it.each([
      'https://www.magalu.com.br/produto',
      'https://maga.lu/abc',
      'https://go.promozone.ai/magalu/x',
    ])('detecta "%s"', (url) => {
      expect(detectMarketplace(url)).toBe('magalu');
    });
  });

  describe('retorna unknown', () => {
    it.each(['https://example.com/produto', 'https://google.com/search', 'texto puro sem URL', ''])(
      'para "%s"',
      (url) => {
        expect(detectMarketplace(url)).toBe('unknown');
      },
    );
  });
});

describe('MARKETPLACE_NAMES', () => {
  it('tem nomes PT-BR para todos os marketplaces', () => {
    expect(MARKETPLACE_NAMES.shopee).toBe('Shopee');
    expect(MARKETPLACE_NAMES.mercadolivre).toBe('Mercado Livre');
    expect(MARKETPLACE_NAMES.amazon).toBe('Amazon');
    expect(MARKETPLACE_NAMES.magalu).toBe('Magalu');
    expect(MARKETPLACE_NAMES.unknown).toBe('Desconhecido');
  });

  it('retorna undefined para marketplace não mapeado', () => {
    expect(MARKETPLACE_NAMES['nao-existe']).toBeUndefined();
  });
});

describe('KNOWN_PLACEHOLDERS', () => {
  it('contém placeholders documentados', () => {
    expect(KNOWN_PLACEHOLDERS.has('texto_original')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('link_convertido')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('link_original')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('marketplace')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('marketplace_nome')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('source_group')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('target_group')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('data')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('hora')).toBe(true);
    expect(KNOWN_PLACEHOLDERS.has('data_hora')).toBe(true);
  });

  it('não contém placeholders condicionais', () => {
    // Placeholders de sintaxe (? / : / /) não são placeholders simples
    expect(KNOWN_PLACEHOLDERS.has('?')).toBe(false);
    expect(KNOWN_PLACEHOLDERS.has(':')).toBe(false);
    expect(KNOWN_PLACEHOLDERS.has('/')).toBe(false);
  });
});

describe('resolvePlaceholders', () => {
  it('substitui {link_original}', () => {
    const result = resolvePlaceholders('Link: {link_original}', baseCtx);
    expect(result).toBe(`Link: ${baseCtx.originalUrl}`);
  });

  it('substitui {link_convertido} quando há URL convertida', () => {
    const result = resolvePlaceholders('Afiliado: {link_convertido}', baseCtx);
    expect(result).toBe(`Afiliado: ${baseCtx.convertedUrl}`);
  });

  it('cai pro link_original quando convertedUrl é null', () => {
    const ctx = { ...baseCtx, convertedUrl: null };
    const result = resolvePlaceholders('{link_convertido}', ctx);
    expect(result).toBe(baseCtx.originalUrl);
  });

  it('substitui {marketplace} com identificador técnico', () => {
    const result = resolvePlaceholders('{marketplace}', baseCtx);
    expect(result).toBe('shopee');
  });

  it('substitui {marketplace_nome} com nome amigável', () => {
    const result = resolvePlaceholders('{marketplace_nome}', baseCtx);
    expect(result).toBe('Shopee');
  });

  it('usa marketplace_nome do dicionário mesmo para unknown', () => {
    const ctx = { ...baseCtx, marketplace: 'unknown' };
    const result = resolvePlaceholders('{marketplace_nome}', ctx);
    expect(result).toBe('Desconhecido');
  });

  it('substitui {source_group} e {target_group}', () => {
    const result = resolvePlaceholders('{source_group} → {target_group}', baseCtx);
    expect(result).toBe('Grupo Origem → Grupo Destino');
  });

  it('formata {data} como dd/MM/yyyy', () => {
    const result = resolvePlaceholders('{data}', baseCtx);
    expect(result).toBe('27/07/2026');
  });

  it('formata {hora} como HH:mm com zero-padding', () => {
    const result = resolvePlaceholders('{hora}', baseCtx);
    expect(result).toBe('14:30');
  });

  it('formata {data_hora} como data + hora', () => {
    const result = resolvePlaceholders('{data_hora}', baseCtx);
    expect(result).toBe('27/07/2026 14:30');
  });

  it('substitui {texto_original} substituindo link na mensagem', () => {
    // originalText contém a URL literal (não {link_original}) para que a
    // substituição automática de URL dentro do texto funcione.
    const ctx: TemplateContext = {
      ...baseCtx,
      originalText: 'Oferta incrível: https://shopee.com.br/product-xyz',
    };
    const result = resolvePlaceholders('{texto_original}', ctx);
    expect(result).toBe('Oferta incrível: https://shp.ee/abc');
  });

  it('preserva {texto_original} quando URL convertida é null', () => {
    const ctx: TemplateContext = {
      ...baseCtx,
      originalText: 'Oferta: https://shopee.com.br/product-xyz',
      convertedUrl: null,
    };
    const result = resolvePlaceholders('{texto_original}', ctx);
    expect(result).toBe('Oferta: https://shopee.com.br/product-xyz');
  });

  it('mantém placeholders não reconhecidos como texto literal', () => {
    const result = resolvePlaceholders('{nao_existe} valor real', baseCtx);
    expect(result).toBe('{nao_existe} valor real');
  });

  it('substitui múltiplas ocorrências do mesmo placeholder', () => {
    const result = resolvePlaceholders('{marketplace} {marketplace} {marketplace}', baseCtx);
    expect(result).toBe('shopee shopee shopee');
  });

  it('combina placeholders com texto literal', () => {
    const result = resolvePlaceholders('Oferta {marketplace_nome} em {link_convertido}', baseCtx);
    expect(result).toBe('Oferta Shopee em https://shp.ee/abc');
  });

  it('não toca em placeholders condicionais {?...}, {/}', () => {
    const input = '{? marketplace = shopee}Sim{/}';
    const result = resolvePlaceholders(input, baseCtx);
    // Os placeholders condicionais são preservados — processConditionals
    // cuida deles em outra etapa.
    expect(result).toBe(input);
  });
});

describe('findUnknownPlaceholders', () => {
  it('retorna array vazio para template sem placeholders', () => {
    expect(findUnknownPlaceholders('Texto puro sem placeholders')).toEqual([]);
  });

  it('retorna array vazio quando todos os placeholders são conhecidos', () => {
    expect(findUnknownPlaceholders('{marketplace} {link_convertido} {data}')).toEqual([]);
  });

  it('detecta placeholder único desconhecido', () => {
    expect(findUnknownPlaceholders('{placeholder_inexistente}')).toEqual([
      'placeholder_inexistente',
    ]);
  });

  it('detecta múltiplos placeholders desconhecidos', () => {
    expect(findUnknownPlaceholders('{foo} {bar} {marketplace} {baz}')).toEqual([
      'foo',
      'bar',
      'baz',
    ]);
  });

  it('ignora placeholders condicionais (começam com ? / : / /)', () => {
    expect(findUnknownPlaceholders('{? marketplace = shopee}{:}{/}')).toEqual([]);
  });

  it('preserva ordem de aparição', () => {
    expect(findUnknownPlaceholders('{z} {a} {m}')).toEqual(['z', 'a', 'm']);
  });
});
