/**
 * Testes adicionais das funções PURAS extraídas em mercadolivre-pure.ts.
 *
 * Cobre as adições da Rodada 3:
 *  - extractMercadoLivreCredentials (env → creds, cookies nunca do env)
 *  - buildOAuthHeaders / buildLinkBuilderApiHeaders / buildLinkBuilderApiBody
 *  - buildCookiesRequestHeaders / buildRefreshCookiesHeaders / COOKIES_USER_AGENT
 *  - isLoginRedirectStatus (302/301)
 *  - formatMissingShortenUrlError
 *  - parseOAuthErrorBody
 *  - canUseStrategy (api/cookies/fallback/none)
 *
 * Não exercita nenhum fetch — só lógica pura.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildCookiesRequestHeaders,
  buildLinkBuilderApiBody,
  buildLinkBuilderApiHeaders,
  buildOAuthHeaders,
  buildRefreshCookiesHeaders,
  canUseStrategy,
  COOKIES_USER_AGENT,
  extractMercadoLivreCredentials,
  formatMissingShortenUrlError,
  isLoginRedirectStatus,
  OAUTH_NO_CREDENTIALS_MESSAGE,
  parseOAuthErrorBody,
  type MlStrategy,
  type MercadoLivreCredentials,
} from './mercadolivre-pure.ts';

describe('extractMercadoLivreCredentials', () => {
  it('mapeia env para credenciais (exceto cookies)', () => {
    const env: Record<string, string | undefined> = {
      ML_CLIENT_ID: 'cid',
      ML_CLIENT_SECRET: 'csec',
      ML_REFRESH_TOKEN: 'rtok',
      ML_MELIID: 'mid',
      ML_MELITAT: 'mat',
      ML_AFFILIATE_TAG: 'tag',
      ML_COOKIES: 'deveria-ser-ignorado',
    };
    const creds = extractMercadoLivreCredentials(env);
    expect(creds).toEqual({
      clientId: 'cid',
      clientSecret: 'csec',
      refreshToken: 'rtok',
      meliid: 'mid',
      melitat: 'mat',
      simpleTag: 'tag',
      cookies: undefined,
    });
  });

  it('retorna tudo undefined quando env vazio', () => {
    const creds = extractMercadoLivreCredentials({});
    expect(creds).toEqual({
      clientId: undefined,
      clientSecret: undefined,
      refreshToken: undefined,
      meliid: undefined,
      melitat: undefined,
      simpleTag: undefined,
      cookies: undefined,
    });
  });

  it('nunca popula cookies a partir do env', () => {
    const creds = extractMercadoLivreCredentials({ ML_COOKIES: 'x' });
    expect(creds.cookies).toBeUndefined();
  });
});

describe('buildOAuthHeaders', () => {
  it('monta Content-Type + Accept JSON', () => {
    expect(buildOAuthHeaders()).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });
});

describe('buildLinkBuilderApiHeaders', () => {
  it('monta Authorization Bearer + Content-Type', () => {
    expect(buildLinkBuilderApiHeaders('tok-123')).toEqual({
      Authorization: 'Bearer tok-123',
      'Content-Type': 'application/json',
    });
  });
});

describe('buildLinkBuilderApiBody', () => {
  it('serializa { url: productUrl }', () => {
    expect(buildLinkBuilderApiBody('https://prod')).toBe(JSON.stringify({ url: 'https://prod' }));
  });
});

describe('buildCookiesRequestHeaders', () => {
  it('monta headers com Cookie, UA, X-Metadata-Session-Id', () => {
    const h = buildCookiesRequestHeaders('sess=1', 'ts-hex');
    expect(h.Cookie).toBe('sess=1');
    expect(h['User-Agent']).toBe(COOKIES_USER_AGENT);
    expect(h['X-Metadata-Session-Id']).toBe('ts-hex');
    expect(h['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
});

describe('buildRefreshCookiesHeaders', () => {
  it('monta headers com Cookie + User-Agent', () => {
    const h = buildRefreshCookiesHeaders('sess=1');
    expect(h.Cookie).toBe('sess=1');
    expect(h['User-Agent']).toBe(COOKIES_USER_AGENT);
  });
});

describe('isLoginRedirectStatus', () => {
  it('retorna true para 302 e 301', () => {
    expect(isLoginRedirectStatus(302)).toBe(true);
    expect(isLoginRedirectStatus(301)).toBe(true);
  });
  it('retorna false para outros status', () => {
    expect(isLoginRedirectStatus(200)).toBe(false);
    expect(isLoginRedirectStatus(500)).toBe(false);
  });
});

describe('formatMissingShortenUrlError', () => {
  it('inclui o JSON da resposta', () => {
    expect(formatMissingShortenUrlError({ x: 1 })).toBe('ML API não retornou shorten_url: {"x":1}');
  });
});

describe('parseOAuthErrorBody', () => {
  it('faz parse do corpo de erro', () => {
    expect(parseOAuthErrorBody('{"message":"invalid_grant"}')).toEqual({
      message: 'invalid_grant',
    });
  });

  it('retorna objeto vazio para JSON inválido', () => {
    expect(parseOAuthErrorBody('not-json')).toEqual({});
  });
});

describe('canUseStrategy', () => {
  const apiCreds: MercadoLivreCredentials = { clientId: 'a', clientSecret: 'b' };
  const cookieCreds: MercadoLivreCredentials = { cookies: 'c' };
  const fallbackCreds: MercadoLivreCredentials = { meliid: 'm', melitat: 't' };

  it('api requer clientId+clientSecret', () => {
    expect(canUseStrategy('api', apiCreds)).toBe(true);
    expect(canUseStrategy('api', { clientId: 'a' })).toBe(false);
    expect(canUseStrategy('api', {})).toBe(false);
  });

  it('cookies requer cookies', () => {
    expect(canUseStrategy('cookies', cookieCreds)).toBe(true);
    expect(canUseStrategy('cookies', {})).toBe(false);
  });

  it('fallback requer meliid/melitat/simpleTag', () => {
    expect(canUseStrategy('fallback', fallbackCreds)).toBe(true);
    expect(canUseStrategy('fallback', { simpleTag: 's' })).toBe(true);
    expect(canUseStrategy('fallback', {})).toBe(false);
  });

  it('estratégia desconhecida retorna false', () => {
    expect(canUseStrategy('none' as MlStrategy, apiCreds)).toBe(false);
  });
});

describe('mensagens de erro constantes', () => {
  it('OAUTH_NO_CREDENTIALS_MESSAGE menciona refresh/authorization_code', () => {
    expect(OAUTH_NO_CREDENTIALS_MESSAGE).toContain('ML_REFRESH_TOKEN');
    expect(OAUTH_NO_CREDENTIALS_MESSAGE).toContain('ML_AUTH_CODE');
  });
});
