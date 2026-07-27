/**
 * Testes das funções PURAS do offer-validator.
 *
 * Cobre (sem rede):
 *  - extractUrls: URLs http/https, URLs sem protocolo (domínios conhecidos),
 *    deduplicação, query strings
 *  - isKnownMarketplaceDomain: marketplace direto + encurtadores conhecidos
 *  - detectMarketplaceByPath: detecção por PATH (redirectors JS)
 *  - detectConnectionError: detecção de erro de conexão Evolution API
 */
import { describe, expect, it } from 'bun:test';
import {
  extractUrls,
  isKnownMarketplaceDomain,
  detectMarketplaceByPath,
  detectConnectionError,
  type GroupValidationResult,
} from './offer-validator.ts';

// ─── extractUrls ────────────────────────────────────────────────────────

describe('extractUrls', () => {
  it('extrai URL https única', () => {
    expect(extractUrls('compre https://shopee.com.br/produto agora')).toEqual([
      'https://shopee.com.br/produto',
    ]);
  });

  it('extrai múltiplas URLs http e https', () => {
    const text =
      'a https://mercadolivre.com.br/x b http://amazon.com.br/d c https://shopee.com.br/y';
    expect(extractUrls(text)).toEqual([
      'https://mercadolivre.com.br/x',
      'http://amazon.com.br/d',
      'https://shopee.com.br/y',
    ]);
  });

  it('captura URL com query string e fragmento', () => {
    expect(extractUrls('https://shopee.com.br/p?ref=1#topo')).toEqual([
      'https://shopee.com.br/p?ref=1#topo',
    ]);
  });

  it('captura URL sem protocolo de domínio conhecido (go.promozone.ai)', () => {
    const result = extractUrls('veja go.promozone.ai/mercadolivre/abc123');
    expect(result).toContain('https://go.promozone.ai/mercadolivre/abc123');
  });

  it('NÃO captura URL sem protocolo de domínio desconhecido', () => {
    const result = extractUrls('visite exemplo.com/produto');
    expect(result).not.toContain('https://exemplo.com/produto');
  });

  it('deduplica URLs idênticas', () => {
    const result = extractUrls('https://shopee.com.br/x https://shopee.com.br/x');
    expect(result).toEqual(['https://shopee.com.br/x']);
  });

  it('retorna array vazio quando não há URL', () => {
    expect(extractUrls('sem links aqui')).toEqual([]);
  });

  it('não duplica versão http/https de domínio sem protocolo', () => {
    // go.promozone.ai aparece como http e https em protocol-less → 1 única
    const text = 'go.promozone.ai/mercadolivre/abc123';
    const result = extractUrls(text);
    expect(result.filter((u) => u.includes('promozone')).length).toBe(1);
  });
});

// ─── isKnownMarketplaceDomain ───────────────────────────────────────────

describe('isKnownMarketplaceDomain', () => {
  it('detecta URL direta de marketplace (shopee)', () => {
    expect(isKnownMarketplaceDomain('https://shopee.com.br/produto')).toBe(true);
  });

  it('detecta URL direta de marketplace (mercadolivre)', () => {
    expect(isKnownMarketplaceDomain('https://www.mercadolivre.com.br/produto')).toBe(true);
  });

  it('detecta URL direta de marketplace (amazon)', () => {
    expect(isKnownMarketplaceDomain('https://amazon.com.br/dp/X')).toBe(true);
  });

  it('detecta encurtador conhecido (meli.la)', () => {
    expect(isKnownMarketplaceDomain('https://meli.la/abc')).toBe(true);
  });

  it('detecta encurtador conhecido (amzn.to)', () => {
    expect(isKnownMarketplaceDomain('https://amzn.to/xyz')).toBe(true);
  });

  it('retorna false para domínio não-relacionado', () => {
    expect(isKnownMarketplaceDomain('https://exemplo.com/pagina')).toBe(false);
  });

  it('retorna false para URL vazia', () => {
    expect(isKnownMarketplaceDomain('')).toBe(false);
  });
});

// ─── detectMarketplaceByPath ────────────────────────────────────────────

describe('detectMarketplaceByPath', () => {
  it('detecta shopee pelo path', () => {
    expect(detectMarketplaceByPath('https://go.promozone.ai/shopee/abc')).toBe('shopee');
  });

  it('detecta shopee pelo path curto /shp', () => {
    expect(detectMarketplaceByPath('https://go.promozone.ai/shp/abc')).toBe('shopee');
  });

  it('detecta mercadolivre pelo path', () => {
    expect(detectMarketplaceByPath('https://go.promozone.ai/mercadolivre/abc')).toBe(
      'mercadolivre',
    );
  });

  it('detecta mercadolibre (es) pelo path', () => {
    expect(detectMarketplaceByPath('https://go.promozone.ai/mercadolibre/abc')).toBe(
      'mercadolivre',
    );
  });

  it('detecta amazon pelo path', () => {
    expect(detectMarketplaceByPath('https://go.promozone.ai/amazon/abc')).toBe('amazon');
  });

  it('retorna unknown para domínio sem path de marketplace', () => {
    expect(detectMarketplaceByPath('https://go.promozone.ai/outro/abc')).toBe('unknown');
  });

  it('retorna unknown para URL inválida', () => {
    expect(detectMarketplaceByPath('não é url')).toBe('unknown');
  });
});

// ─── detectConnectionError ─────────────────────────────────────────────

function makeGroup(passed: boolean, errors: string[]): GroupValidationResult {
  return {
    groupJid: 'g',
    groupName: 'G',
    totalMessages: 0,
    validOffers: 0,
    invalidMessages: 0,
    ratio: 0,
    passed,
    errors,
  };
}

describe('detectConnectionError', () => {
  it('retorna undefined para lista vazia', () => {
    expect(detectConnectionError([])).toBeUndefined();
  });

  it('retorna undefined quando algum grupo passou', () => {
    const result = detectConnectionError([makeGroup(true, []), makeGroup(false, ['erro'])]);
    expect(result).toBeUndefined();
  });

  it('detecta erro de conexão (fetch failed)', () => {
    const result = detectConnectionError([makeGroup(false, ['fetch failed: ECONNREFUSED'])]);
    expect(result).toBeDefined();
    expect(result).toMatch(/fetch failed/i);
  });

  it('detecta erro de conexão (Evolution API)', () => {
    const result = detectConnectionError([makeGroup(false, ['Evolution API retornou HTTP 500'])]);
    expect(result).toBeDefined();
  });

  it('retorna undefined quando erro não é de conexão (baixa taxa)', () => {
    const result = detectConnectionError([makeGroup(false, ['poucas ofertas válidas'])]);
    expect(result).toBeUndefined();
  });

  it('retorna undefined quando grupos têm erros mistos', () => {
    const result = detectConnectionError([
      makeGroup(false, ['fetch failed']),
      makeGroup(false, ['poucas ofertas válidas']),
    ]);
    expect(result).toBeUndefined();
  });

  it('retorna undefined quando algum grupo não tem erros', () => {
    const result = detectConnectionError([
      makeGroup(false, ['fetch failed']),
      makeGroup(false, []),
    ]);
    expect(result).toBeUndefined();
  });

  it('prioriza erro específico sobre genérico', () => {
    const result = detectConnectionError([
      makeGroup(false, ['ECONNREFUSED ao conectar']),
      makeGroup(false, ['Erro ao buscar mensagens do grupo']),
    ]);
    expect(result).toMatch(/ECONNREFUSED/i);
  });
});
