/**
 * Testes das funções PURAS do conversor de Mercado Livre (mercadolivre-pure.ts).
 *
 * Cobre 100% das funções puras, incluindo todos os branchs de:
 *  - buildOAuthPayload (refresh / authorization_code / nenhum → null)
 *  - formatOAuthError
 *  - extractShortenUrl (presente / ausente)
 *  - formatApiError
 *  - isLoginRedirect (login / lgz / outro)
 *  - extractMeliLaLink (padrão solto / href / nenhum)
 *  - mergeCookies (preserva / sobrescreve / atributos / múltiplos / vazio / sem-key)
 *  - generateViaUrlParams (4 formatos + validação)
 *  - isMercadoLivreUrl / isMeliLaShortUrl
 *  - formatMetadataSessionId
 *  - buildNotMercadoLivreResult / buildErrorResult / buildConversionResult
 *
 * Não exercita nenhum fetch — só lógica pura.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildConversionResult,
  buildErrorResult,
  buildNotMercadoLivreResult,
  buildOAuthPayload,
  extractMeliLaLink,
  extractShortenUrl,
  formatApiError,
  formatMetadataSessionId,
  formatOAuthError,
  generateViaUrlParams,
  isLoginRedirect,
  isMeliLaShortUrl,
  isMercadoLivreUrl,
  mergeCookies,
  type MercadoLivreCredentials,
} from './mercadolivre-pure.ts';

describe('buildOAuthPayload', () => {
  it('monta grant_type=refresh_token quando refreshToken presente', () => {
    const p = buildOAuthPayload({
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'rtok',
    });
    expect(p).toEqual({
      grant_type: 'refresh_token',
      client_id: 'cid',
      client_secret: 'csec',
      refresh_token: 'rtok',
    });
  });

  it('monta grant_type=authorization_code quando code+redirectUri presentes', () => {
    const p = buildOAuthPayload({
      clientId: 'cid',
      clientSecret: 'csec',
      code: 'authcode',
      redirectUri: 'https://cb',
    });
    expect(p).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid',
      client_secret: 'csec',
      code: 'authcode',
      redirect_uri: 'https://cb',
    });
  });

  it('prioriza refreshToken sobre code+redirectUri', () => {
    const p = buildOAuthPayload({
      clientId: 'cid',
      clientSecret: 'csec',
      code: 'authcode',
      redirectUri: 'https://cb',
      refreshToken: 'rtok',
    });
    expect(p?.grant_type).toBe('refresh_token');
  });

  it('retorna null quando nem refreshToken nem code+redirectUri', () => {
    expect(buildOAuthPayload({ clientId: 'cid', clientSecret: 'csec' })).toBeNull();
    expect(buildOAuthPayload({ clientId: 'cid', clientSecret: 'csec', code: 'x' })).toBeNull();
    expect(
      buildOAuthPayload({ clientId: 'cid', clientSecret: 'csec', redirectUri: 'y' }),
    ).toBeNull();
  });
});

describe('formatOAuthError', () => {
  it('usa a mensagem quando presente', () => {
    expect(formatOAuthError(401, 'invalid_grant', 'Unauthorized')).toBe(
      'OAuth erro 401: invalid_grant',
    );
  });

  it('cai no statusText quando mensagem ausente/undefined', () => {
    expect(formatOAuthError(500, undefined, 'Internal Server Error')).toBe(
      'OAuth erro 500: Internal Server Error',
    );
    expect(formatOAuthError(403, '', 'Forbidden')).toBe('OAuth erro 403: Forbidden');
  });
});

describe('extractShortenUrl', () => {
  it('retorna shorten_url quando presente', () => {
    expect(extractShortenUrl({ shorten_url: 'https://meli.la/x', status: 'OK' })).toBe(
      'https://meli.la/x',
    );
  });

  it('retorna null quando shorten_url vazio', () => {
    expect(extractShortenUrl({ shorten_url: '', long_url: 'y' })).toBeNull();
  });

  it('retorna null quando a chave ausente', () => {
    expect(extractShortenUrl({ long_url: 'y' } as Record<string, unknown>)).toBeNull();
  });
});

describe('formatApiError', () => {
  it('usa o texto quando presente', () => {
    expect(formatApiError(429, 'rate limit', 'Too Many Requests')).toBe(
      'ML API erro 429: rate limit',
    );
  });

  it('cai no statusText quando texto vazio/ausente', () => {
    expect(formatApiError(500, '', 'Server Error')).toBe('ML API erro 500: Server Error');
    expect(formatApiError(502, undefined as unknown as string, 'Bad Gateway')).toBe(
      'ML API erro 502: Bad Gateway',
    );
  });
});

describe('isLoginRedirect', () => {
  it('detecta "login" no location', () => {
    expect(isLoginRedirect('https://www.mercadolivre.com.br/login?x=1')).toBe(true);
  });
  it('detecta "lgz" no location', () => {
    expect(isLoginRedirect('https://www.mercadolivre.com.br/lgz/out')).toBe(true);
  });
  it('retorna false para location sem login/lgz', () => {
    expect(isLoginRedirect('https://meli.la/abc')).toBe(false);
    expect(isLoginRedirect('')).toBe(false);
  });
});

describe('extractMeliLaLink', () => {
  it('extrai padrão meli.la/XXX solto', () => {
    expect(extractMeliLaLink('blabla meli.la/ABC123 fim')).toBe('https://meli.la/ABC123');
  });

  it('extrai via href="https://meli.la/..."', () => {
    expect(extractMeliLaLink('veja <a href="https://meli.la/xyz99">aqui</a>')).toBe(
      'https://meli.la/xyz99',
    );
  });

  it('retorna null quando nenhum padrão encontrado', () => {
    expect(extractMeliLaLink('sem link nenhum')).toBeNull();
    expect(extractMeliLaLink('')).toBeNull();
  });
});

describe('mergeCookies', () => {
  it('preserva cookies existentes', () => {
    const result = mergeCookies('session_id=abc; user_id=42', 'csrftoken=xyz');
    expect(result).toContain('session_id=abc');
    expect(result).toContain('user_id=42');
    expect(result).toContain('csrftoken=xyz');
  });

  it('sobrescreve cookie existente com novo valor', () => {
    const result = mergeCookies('session_id=old; user_id=42', 'session_id=new');
    expect(result).toContain('session_id=new');
    expect(result).not.toContain('session_id=old');
    expect(result).toContain('user_id=42');
  });

  it('parseia Set-Cookie com atributos (Path, Expires, HttpOnly)', () => {
    const result = mergeCookies(
      'session_id=abc',
      'csrftoken=xyz; Path=/; Expires=Thu, 01 Jan 2026 00:00:00 GMT; HttpOnly',
    );
    expect(result).toContain('csrftoken=xyz');
    expect(result).not.toContain('Path=/');
    expect(result).not.toContain('Expires');
    expect(result).not.toContain('HttpOnly');
  });

  it('lida com múltiplos cookies separados por vírgula', () => {
    const result = mergeCookies('a=1', 'b=2, c=3, d=4');
    expect(result).toContain('a=1');
    expect(result).toContain('b=2');
    expect(result).toContain('c=3');
    expect(result).toContain('d=4');
  });

  it('retorna só os existentes quando Set-Cookie é vazio', () => {
    const result = mergeCookies('session_id=abc; user_id=42', '');
    expect(result).toContain('session_id=abc');
    expect(result).toContain('user_id=42');
  });

  it('ignora entrada sem key no setCookie', () => {
    const result = mergeCookies('a=1', '=invalid');
    expect(result).toContain('a=1');
    expect(result).not.toContain('=invalid');
  });
});

describe('generateViaUrlParams', () => {
  const baseUrl = 'https://www.mercadolivre.com.br/produto/MLB-123456';

  it('formato meliid+melitat (clube antigo)', () => {
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

  it('aceita só meliid (cai no branch else)', () => {
    const r = generateViaUrlParams(baseUrl, { meliid: 'onlyid' });
    expect(r).toContain('meliid=onlyid');
  });

  it('lança quando nenhuma credencial de fallback é fornecida', () => {
    expect(() => generateViaUrlParams(baseUrl, {})).toThrow(/Nenhuma credencial/);
  });

  it('lança quando todas as credenciais são strings vazias', () => {
    const empty: MercadoLivreCredentials = { meliid: '', melitat: '', simpleTag: '' };
    expect(() => generateViaUrlParams(baseUrl, empty)).toThrow(/Nenhuma credencial/);
  });
});

describe('isMercadoLivreUrl', () => {
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

describe('isMeliLaShortUrl', () => {
  it('detecta link curto meli.la', () => {
    expect(isMeliLaShortUrl('https://meli.la/abc123')).toBe(true);
  });
  it('retorna false para URL normal de produto', () => {
    expect(isMeliLaShortUrl('https://www.mercadolivre.com.br/produto')).toBe(false);
  });
  it('retorna false para URL vazia', () => {
    expect(isMeliLaShortUrl('')).toBe(false);
  });
});

describe('formatMetadataSessionId', () => {
  it('junta timestamp36 e hex com hífen', () => {
    expect(formatMetadataSessionId('abc123', 'deadbeef')).toBe('abc123-deadbeef');
  });
});

describe('buildNotMercadoLivreResult', () => {
  it('monta erro de marketplace não-ML', () => {
    const r = buildNotMercadoLivreResult('https://shopee.com/x', 'shopee');
    expect(r).toEqual({
      success: false,
      originalUrl: 'https://shopee.com/x',
      affiliateUrl: null,
      marketplace: 'shopee',
      method: 'unknown',
      error: 'URL não é do Mercado Livre',
    });
  });
});

describe('buildErrorResult', () => {
  it('extrai message de Error', () => {
    const r = buildErrorResult('https://x', new Error('boom'));
    expect(r.success).toBe(false);
    expect(r.error).toBe('boom');
    expect(r.method).toBe('unknown');
  });

  it('converte valor não-Error para String', () => {
    const r = buildErrorResult('https://x', 'string error');
    expect(r.error).toBe('string error');
  });
});

describe('buildConversionResult', () => {
  it('sucesso quando affiliateLink presente', () => {
    const r = buildConversionResult('https://x', 'https://meli.la/y', 'api');
    expect(r).toEqual({
      success: true,
      originalUrl: 'https://x',
      affiliateUrl: 'https://meli.la/y',
      marketplace: 'mercadolivre',
      method: 'api',
      error: undefined,
    });
  });

  it('method none → unknown quando link ausente', () => {
    const r = buildConversionResult('https://x', null, 'none');
    expect(r.success).toBe(false);
    expect(r.method).toBe('unknown');
    expect(r.error).toBe('Nenhuma estratégia conseguiu gerar o link');
  });

  it('erro quando link ausente e método definido', () => {
    const r = buildConversionResult('https://x', null, 'cookies');
    expect(r.success).toBe(false);
    expect(r.method).toBe('cookies');
    expect(r.error).toBe('Nenhuma estratégia conseguiu gerar o link');
  });
});
