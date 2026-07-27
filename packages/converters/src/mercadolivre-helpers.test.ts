/**
 * Testes complementares do conversor de Mercado Livre — funções PURAS.
 *
 * Cobre:
 *  - _testGenerateMetadataSessionId: formato `${timestamp36}-${hex}`
 *  - generateViaUrlParams: todos os formatos de fallback + casos de borda
 *    (valores vazios, ausência de credenciais, múltiplos params preservados)
 *  - isMercadoLivreUrl: host variations
 *
 * Não altera nenhum header — apenas exercita a lógica pura já existente.
 */
import { describe, expect, it } from 'bun:test';
import {
  _testGenerateMetadataSessionId,
  generateViaUrlParams,
  isMercadoLivreUrl,
  type MercadoLivreCredentials,
} from './mercadolivre.ts';

describe('_testGenerateMetadataSessionId', () => {
  it('gera id no formato <timestamp36>-<hex16>', () => {
    const id = _testGenerateMetadataSessionId();
    expect(id).toMatch(/^[0-9a-z]+-[0-9a-f]{32}$/);
  });

  it('gera ids distintos a cada chamada', () => {
    const a = _testGenerateMetadataSessionId();
    const b = _testGenerateMetadataSessionId();
    expect(a).not.toBe(b);
  });
});

describe('generateViaUrlParams — formatos de fallback', () => {
  const baseUrl = 'https://www.mercadolivre.com.br/produto/MLB-123456';

  it('formato meliid+melitat (clube de afiliados antigo)', () => {
    const r = generateViaUrlParams(baseUrl, { meliid: 'm1', melitat: 't1' });
    expect(r).toBe(`${baseUrl}?meliid=m1&melitat=t1`);
  });

  it('formato simpleTag', () => {
    const r = generateViaUrlParams(baseUrl, { simpleTag: 'stag' });
    expect(r).toBe(`${baseUrl}?tag=stag`);
  });

  it('formato novo (só melitat → matt_word + matt_tool fixo)', () => {
    const r = generateViaUrlParams(baseUrl, { melitat: 'word' });
    expect(r).toBe(`${baseUrl}?matt_word=word&matt_tool=71835809`);
  });

  it('simpleTag tem prioridade sobre meliid+melitat ausentes', () => {
    const r = generateViaUrlParams(baseUrl, { meliid: '', melitat: 'x', simpleTag: 'prio' });
    expect(r).toBe(`${baseUrl}?tag=prio`);
  });

  it('preserva query params originais', () => {
    const r = generateViaUrlParams(`${baseUrl}?ref=origem`, { meliid: 'm1', melitat: 't1' });
    expect(r).toContain('ref=origem');
    expect(r).toContain('meliid=m1');
    expect(r).toContain('melitat=t1');
  });

  it('lança quando nenhuma credencial de fallback é fornecida', () => {
    expect(() => generateViaUrlParams(baseUrl, {})).toThrow(/Nenhuma credencial/);
  });

  it('lança quando todas as credenciais são strings vazias', () => {
    const empty: MercadoLivreCredentials = { meliid: '', melitat: '', simpleTag: '' };
    expect(() => generateViaUrlParams(baseUrl, empty)).toThrow(/Nenhuma credencial/);
  });

  it('aceita só meliid (cai no branch else)', () => {
    const r = generateViaUrlParams(baseUrl, { meliid: 'onlyid' });
    expect(r).toContain('meliid=onlyid');
  });
});

describe('isMercadoLivreUrl — variações de host', () => {
  it('detecta mercadolivre.com.br', () => {
    expect(isMercadoLivreUrl('https://www.mercadolivre.com.br/produto')).toBe(true);
  });

  it('detecta mercadolivre.com.br', () => {
    expect(isMercadoLivreUrl('https://www.mercadolivre.com.br/produto')).toBe(true);
  });

  it('detecta meli.la', () => {
    expect(isMercadoLivreUrl('https://meli.la/abc123')).toBe(true);
  });

  it('retorna false para amazon', () => {
    expect(isMercadoLivreUrl('https://www.amazon.com.br/dp/X')).toBe(false);
  });

  it('retorna false para shopee', () => {
    expect(isMercadoLivreUrl('https://shopee.com.br/produto')).toBe(false);
  });

  it('retorna false para URL vazia', () => {
    expect(isMercadoLivreUrl('')).toBe(false);
  });
});
