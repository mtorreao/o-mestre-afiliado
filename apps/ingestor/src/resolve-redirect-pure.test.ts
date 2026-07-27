/**
 * Testes das funções PURAS de resolve-redirect (sem I/O de rede).
 * `stripMeliTrackingParams` e `isMeliProductUrl` operam só sobre strings/URL.
 */
import { describe, expect, it } from 'bun:test';
import { stripMeliTrackingParams, isMeliProductUrl } from './resolve-redirect.ts';

describe('stripMeliTrackingParams', () => {
  it('remove params de tracking do ML', () => {
    const { url, dropped } = stripMeliTrackingParams(
      'https://www.mercadolivre.com.br/p/MLB123?source=x&c_id=1&sid=2',
    );
    expect(dropped).toContain('source');
    expect(dropped).toContain('c_id');
    expect(dropped).toContain('sid');
    expect(url).not.toContain('source');
    expect(url).not.toContain('c_id');
  });

  it('remove fragment hashtag', () => {
    const { url, dropped } = stripMeliTrackingParams(
      'https://www.mercadolivre.com.br/p/MLB123#section',
    );
    expect(url).not.toContain('#');
    expect(dropped).toEqual([]);
  });

  it('preserva params não listados', () => {
    const { url } = stripMeliTrackingParams('https://www.mercadolivre.com.br/p/MLB123?foo=bar');
    expect(url).toContain('foo=bar');
  });

  it('retorna url inalterada se new URL falhar', () => {
    const bad = 'not a url';
    const { url, dropped } = stripMeliTrackingParams(bad);
    expect(url).toBe(bad);
    expect(dropped).toEqual([]);
  });

  it('retorna dropped vazio quando não há params de tracking', () => {
    const { dropped } = stripMeliTrackingParams('https://www.mercadolivre.com.br/p/MLB123');
    expect(dropped).toEqual([]);
  });
});

describe('isMeliProductUrl — edge cases', () => {
  it('retorna false para URL inválida', () => {
    expect(isMeliProductUrl('url-quebrada')).toBe(false);
  });

  it('retorna false para hostname não-ML', () => {
    expect(isMeliProductUrl('https://shopee.com.br/p/MLB123')).toBe(false);
  });

  it('retorna false para /ofertas (não produto)', () => {
    expect(isMeliProductUrl('https://www.mercadolivre.com.br/ofertas')).toBe(false);
  });

  it('retorna false para /coupons', () => {
    expect(isMeliProductUrl('https://www.mercadolivre.com.br/coupons/1TTwcDm')).toBe(false);
  });

  it('/p/MLB<id> é produto', () => {
    expect(isMeliProductUrl('https://www.mercadolivre.com.br/x/p/MLB22019628')).toBe(true);
  });
});
