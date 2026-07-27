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
  buildLinkBuilderPageHeaders,
  formatCsrfRetrievalError,
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
