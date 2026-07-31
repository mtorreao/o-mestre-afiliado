/**
 * Testes das funções PURAS adicionais de ml-linkbuilder-pure.ts (Rodada 3):
 *  - ML_LINK_BUILDER_URL / ML_CREATE_LINK_API / META_UA constantes
 *  - buildLinkBuilderPageHeaders
 *  - buildCreateLinkApiHeaders (csrf + origem/referer)
 *  - formatCsrfRetrievalError
 *
 * Não exercita nenhum fetch — só lógica pura.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildCreateLinkApiHeaders,
  buildCsrfCacheKey,
  buildLinkBuilderPageHeaders,
  fingerprintCookies,
  formatCsrfRetrievalError,
  formatRenewalFailedError,
  isSessionExpiredStatus,
  META_UA,
  ML_CREATE_LINK_API,
  ML_LINK_BUILDER_URL,
} from './ml-linkbuilder-pure.ts';

describe('constantes', () => {
  it('URLs e UA batem o esperado', () => {
    expect(ML_LINK_BUILDER_URL).toBe('https://www.mercadolivre.com.br/afiliados/linkbuilder');
    expect(ML_CREATE_LINK_API).toBe(
      'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink',
    );
    expect(META_UA).toContain('Chrome/150.0.0.0');
  });
});

describe('buildLinkBuilderPageHeaders', () => {
  it('monta Cookie + User-Agent', () => {
    const h = buildLinkBuilderPageHeaders('sess=1');
    expect(h.Cookie).toBe('sess=1');
    expect(h['User-Agent']).toBe(META_UA);
  });
});

describe('buildCreateLinkApiHeaders', () => {
  it('monta headers com csrf, cookie, referer, origin', () => {
    const h = buildCreateLinkApiHeaders('sess=1', 'csrf-token-xyz');
    expect(h['Content-Type']).toBe('application/json');
    expect(h['x-csrf-token']).toBe('csrf-token-xyz');
    expect(h.Cookie).toBe('sess=1');
    expect(h.Referer).toBe(ML_LINK_BUILDER_URL);
    expect(h.Origin).toBe('https://www.mercadolivre.com.br');
    expect(h['User-Agent']).toBe(META_UA);
  });

  it('aceita User-Agent customizado', () => {
    const h = buildCreateLinkApiHeaders('sess', 'csrf', 'MyUA/1.0');
    expect(h['User-Agent']).toBe('MyUA/1.0');
  });
});

describe('formatCsrfRetrievalError', () => {
  it('inclui a mensagem de erro de Error', () => {
    expect(formatCsrfRetrievalError(new Error('boom'))).toBe('Erro ao obter CSRF token: boom');
  });

  it('converte valor não-Error para String', () => {
    expect(formatCsrfRetrievalError('falha')).toBe('Erro ao obter CSRF token: falha');
  });
});

describe('isSessionExpiredStatus', () => {
  it('reconhece 401 e 403 como sessão expirada', () => {
    expect(isSessionExpiredStatus(401)).toBe(true);
    expect(isSessionExpiredStatus(403)).toBe(true);
  });

  it('demais status não são sessão expirada', () => {
    expect(isSessionExpiredStatus(200)).toBe(false);
    expect(isSessionExpiredStatus(302)).toBe(false);
    expect(isSessionExpiredStatus(404)).toBe(false);
    expect(isSessionExpiredStatus(500)).toBe(false);
  });
});

describe('fingerprintCookies', () => {
  it('é determinístico: mesmos cookies → mesmo fingerprint', () => {
    expect(fingerprintCookies('a=1; b=2')).toBe(fingerprintCookies('a=1; b=2'));
  });

  it('muda quando os cookies mudam (reimportação/expiração)', () => {
    expect(fingerprintCookies('a=1')).not.toBe(fingerprintCookies('a=2'));
    expect(fingerprintCookies('a=1')).not.toBe(fingerprintCookies('a=1; b=2'));
  });

  it('vetor FNV-1a conhecido (string vazia)', () => {
    expect(fingerprintCookies('')).toBe((0x811c9dc5 >>> 0).toString(36));
  });
});

describe('buildCsrfCacheKey', () => {
  it('chave = tag + fingerprint dos cookies', () => {
    const key = buildCsrfCacheKey('mtorreao', 'a=1');
    expect(key).toBe(`mtorreao|${fingerprintCookies('a=1')}`);
  });

  it('tags diferentes → chaves diferentes (cache por afiliado)', () => {
    expect(buildCsrfCacheKey('mtorreao', 'a=1')).not.toBe(buildCsrfCacheKey('om895584', 'a=1'));
  });

  it('cookies diferentes → chaves diferentes (invalidação natural)', () => {
    expect(buildCsrfCacheKey('mtorreao', 'a=1')).not.toBe(buildCsrfCacheKey('mtorreao', 'a=2'));
  });
});

describe('formatRenewalFailedError', () => {
  it('mantém marcadores de cookie expirado para fallback/classificação', () => {
    const msg = formatRenewalFailedError(401);
    expect(msg).toContain('HTTP 401');
    expect(msg).toContain('Cookies podem estar expirados');
  });

  it('reflete o status recebido', () => {
    expect(formatRenewalFailedError(403)).toContain('HTTP 403');
  });
});
