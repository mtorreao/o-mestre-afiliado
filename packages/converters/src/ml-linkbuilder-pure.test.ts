/**
 * Testes das funções PURAS da geração de links curtos ML (ml-linkbuilder-pure.ts).
 *
 * CSRF extraction, body do POST, parsing/classificação da resposta e
 * formatação de erros HTTP — sem nenhum fetch real.
 */
import { describe, expect, it } from 'bun:test';
import {
  CSRF_NOT_FOUND_MESSAGE,
  EMPTY_URLS_MESSAGE,
  MISSING_SHORT_URL_MESSAGE,
  buildCreateLinkBody,
  extractCsrfToken,
  formatLinkBuilderHttpError,
  parseCreateLinkResponse,
  type CreateLinkResponse,
} from './ml-linkbuilder-pure.ts';

describe('extractCsrfToken', () => {
  it('extrai o token do <meta name="csrf-token">', () => {
    const html = '<html><head><meta name="csrf-token" content="abc123xyz"></head></html>';
    expect(extractCsrfToken(html)).toBe('abc123xyz');
  });

  it('extrai mesmo com atributos fora de ordem (case-insensitive no nome)', () => {
    const html = '<META NAME="CSRF-TOKEN" CONTENT="TOK_9"></META>';
    expect(extractCsrfToken(html)).toBe('TOK_9');
  });

  it('retorna null quando o <meta> não está presente', () => {
    expect(extractCsrfToken('<html><body>sem token</body></html>')).toBeNull();
  });

  it('retorna null para HTML vazio', () => {
    expect(extractCsrfToken('')).toBeNull();
  });
});

describe('buildCreateLinkBody', () => {
  it('monta { urls: [productUrl], tag }', () => {
    expect(buildCreateLinkBody('https://produto', 'mtorreao')).toEqual({
      urls: ['https://produto'],
      tag: 'mtorreao',
    });
  });

  it('preserva a URL original (sem normalização)', () => {
    const body = buildCreateLinkBody('https://ML.com/x?p=1', 'tag-1');
    expect(body.urls).toEqual(['https://ML.com/x?p=1']);
    expect(body.tag).toBe('tag-1');
  });
});

describe('formatLinkBuilderHttpError', () => {
  it('formata erro de acesso à página (GET)', () => {
    expect(formatLinkBuilderHttpError('page', 403)).toBe('Falha ao acessar Link Builder: HTTP 403');
  });

  it('formata erro da API (POST)', () => {
    expect(formatLinkBuilderHttpError('api', 500)).toBe('API do Link Builder retornou HTTP 500');
  });

  it('distingue os dois escopos para o mesmo status', () => {
    expect(formatLinkBuilderHttpError('page', 401)).not.toBe(
      formatLinkBuilderHttpError('api', 401),
    );
  });
});

describe('parseCreateLinkResponse', () => {
  it('sucesso: retorna shortUrl e longUrl', () => {
    const data: CreateLinkResponse = {
      status: 200,
      urls: [
        {
          short_url: 'https://meli.la/abc',
          long_url: 'https://www.mercadolivre.com.br/produto',
        },
      ],
    };
    expect(parseCreateLinkResponse(data)).toEqual({
      success: true,
      shortUrl: 'https://meli.la/abc',
      longUrl: 'https://www.mercadolivre.com.br/produto',
    });
  });

  it('sucesso: shortUrl sem longUrl (longUrl undefined)', () => {
    const data: CreateLinkResponse = {
      status: 200,
      urls: [{ short_url: 'https://meli.la/xyz' }],
    };
    expect(parseCreateLinkResponse(data)).toEqual({
      success: true,
      shortUrl: 'https://meli.la/xyz',
      longUrl: undefined,
    });
  });

  it('erro: resposta sem array urls → EMPTY_URLS_MESSAGE', () => {
    const data: CreateLinkResponse = { status: 200 };
    expect(parseCreateLinkResponse(data)).toEqual({
      success: false,
      error: EMPTY_URLS_MESSAGE,
      errorKind: 'unknown',
    });
  });

  it('erro: urls vazio → EMPTY_URLS_MESSAGE', () => {
    const data: CreateLinkResponse = { status: 200, urls: [] };
    expect(parseCreateLinkResponse(data).error).toBe(EMPTY_URLS_MESSAGE);
  });

  it('erro interno: mensagem de tag → erro acionável + errorKind', () => {
    const data: CreateLinkResponse = {
      status: 200,
      urls: [{ error_code: 400, message: 'tag inválida' }],
    };
    const r = parseCreateLinkResponse(data);
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe('tag_mismatch');
    expect(r.error).toContain('Tag não associada ao afiliado');
  });

  it('erro interno: fallback para código quando message ausente', () => {
    const data: CreateLinkResponse = {
      status: 200,
      urls: [{ error_code: 99 }],
    };
    expect(parseCreateLinkResponse(data)).toEqual({
      success: false,
      error: 'Erro do Link Builder: código 99',
      errorKind: 'unknown',
    });
  });

  it('erro: urls[0] sem short_url → MISSING_SHORT_URL_MESSAGE', () => {
    const data: CreateLinkResponse = {
      status: 200,
      urls: [{ long_url: 'https://x' }],
    };
    expect(parseCreateLinkResponse(data)).toEqual({
      success: false,
      error: MISSING_SHORT_URL_MESSAGE,
      errorKind: 'unknown',
    });
  });
});

describe('mensagens de erro compartilhadas', () => {
  it('CSRF_NOT_FOUND_MESSAGE tem a hint de cookies expirados', () => {
    expect(CSRF_NOT_FOUND_MESSAGE).toContain('Cookies');
  });

  it('EMPTY_URLS_MESSAGE e MISSING_SHORT_URL_MESSAGE são distintas', () => {
    expect(EMPTY_URLS_MESSAGE).not.toBe(MISSING_SHORT_URL_MESSAGE);
  });
});
