/**
 * Testes das funções PURAS em apps/ingestor/src/link-converters.ts.
 *
 * Cobrem 100% das funções de decisão extraídas da orquestração assíncrona:
 *  - extractUserIdFromInstanceName
 *  - resolveEffectiveMarketplace
 *  - classifyUnsupportedMarketplace
 *
 * A camada de I/O (resolveRedirectUrl, repositórios, @omestre/converters)
 * vive em `convertOfferUrl` e não é exercitada aqui.
 */
import { describe, expect, it } from 'bun:test';
import {
  extractUserIdFromInstanceName,
  resolveEffectiveMarketplace,
  classifyUnsupportedMarketplace,
} from './link-converters.ts';

// ─── extractUserIdFromInstanceName ─────────────────────────────────────

describe('extractUserIdFromInstanceName', () => {
  it('extrai userId de user-{id}', () => {
    expect(extractUserIdFromInstanceName('user-42')).toBe(42);
  });

  it('retorna null para instância global (sem formato user-)', () => {
    expect(extractUserIdFromInstanceName('minha-instancia')).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(extractUserIdFromInstanceName('')).toBeNull();
  });

  it('retorna null para undefined', () => {
    expect(extractUserIdFromInstanceName(undefined)).toBeNull();
  });

  it('retorna null para null', () => {
    expect(extractUserIdFromInstanceName(null)).toBeNull();
  });

  it('retorna null quando userId não é numérico', () => {
    expect(extractUserIdFromInstanceName('user-abc')).toBeNull();
  });

  it('retorna null para formato user- mas com sinal/fracionário', () => {
    expect(extractUserIdFromInstanceName('user-1.5')).toBeNull();
  });
});

// ─── resolveEffectiveMarketplace ──────────────────────────────────────

describe('resolveEffectiveMarketplace', () => {
  it('mantém o marketplace detectado quando a URL não redirecionou', () => {
    const url = 'https://shopee.com.br/produto-i.1.2';
    expect(resolveEffectiveMarketplace('shopee', url, url)).toBe('shopee');
  });

  it('mantém o detectado quando o redirecionamento não resolveu marketplace conhecido', () => {
    const original = 'https://shopee.com.br/produto-i.1.2';
    const resolved = 'https://exemplo-que-nao-e-marketplace.com/foo';
    expect(resolveEffectiveMarketplace('shopee', original, resolved)).toBe('shopee');
  });

  it('adota o marketplace resolvido quando o redirector aponta para outro conhecido', () => {
    const original = 'https://meli.la/2tLscs8';
    const resolved = 'https://www.mercadolivre.com.br/social/om895584';
    expect(resolveEffectiveMarketplace('unknown', original, resolved)).toBe('mercadolivre');
  });

  it('adota o resolvido mesmo quando o original era conhecido (shopee → mercadolivre)', () => {
    const original = 'https://s.shopee.com.br/abc';
    const resolved = 'https://www.mercadolivre.com.br/produto/p/MLB123';
    expect(resolveEffectiveMarketplace('shopee', original, resolved)).toBe('mercadolivre');
  });

  it('não adota o resolvido quando ousa mas o resolved é unknown', () => {
    const original = 'https://shopee.com.br/produto-i.1.2';
    const resolved = 'https://nao-marketplace.com/x';
    expect(resolveEffectiveMarketplace('shopee', original, resolved)).toBe('shopee');
  });
});

// ─── classifyUnsupportedMarketplace ───────────────────────────────────

describe('classifyUnsupportedMarketplace', () => {
  it('retorna null para magalu (integrado)', () => {
    expect(classifyUnsupportedMarketplace('magalu')).toBeNull();
  });

  it('retorna null para shopee (suportado)', () => {
    expect(classifyUnsupportedMarketplace('shopee')).toBeNull();
  });

  it('retorna null para mercadolivre (suportado)', () => {
    expect(classifyUnsupportedMarketplace('mercadolivre')).toBeNull();
  });

  it('retorna null para amazon (suportado)', () => {
    expect(classifyUnsupportedMarketplace('amazon')).toBeNull();
  });

  it('retorna null para marketplace desconhecido', () => {
    expect(classifyUnsupportedMarketplace('desconhecido')).toBeNull();
  });

  it('retorna null para unknown exato', () => {
    expect(classifyUnsupportedMarketplace('unknown')).toBeNull();
  });
});
