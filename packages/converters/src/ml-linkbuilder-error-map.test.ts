/**
 * Testes do MAPA DE ERROS do Link Builder ML (ml-linkbuilder-pure.ts).
 *
 * Itens 8 e 9 de docs/plans/melhorias-ml.md:
 *  - 109: tag não associada ao afiliado → mensagem acionável (reimportar cookies)
 *  - 111 / "URL not allowed": produto não elegível → mensagem acionável
 *  - 401: não autorizado → cookies expirados
 *  - Classificação por marcadores (PT/ES/EN) quando não há error_code.
 */
import { describe, expect, it } from 'bun:test';
import {
  classifyMlShortLinkError,
  formatCreateLinkError,
  ML_COOKIE_EXPIRED_MESSAGE,
  ML_PRODUCT_NOT_ELIGIBLE_MESSAGE,
  ML_TAG_MISMATCH_MESSAGE,
  parseCreateLinkResponse,
  type CreateLinkResponse,
} from './ml-linkbuilder-pure.ts';

describe('classifyMlShortLinkError', () => {
  it('HTTP 401/403 → cookie_expired (status tem precedência)', () => {
    expect(classifyMlShortLinkError('qualquer coisa', 401)).toBe('cookie_expired');
    expect(classifyMlShortLinkError('qualquer coisa', 403)).toBe('cookie_expired');
  });

  it('demais status não são sessão expirada', () => {
    expect(classifyMlShortLinkError('erro interno', 500)).toBe('unknown');
    expect(classifyMlShortLinkError('erro interno', 400)).toBe('unknown');
  });

  it('marcadores de cookie expirado (PT/EN)', () => {
    expect(
      classifyMlShortLinkError(
        'Não foi possível renovar os cookies de sessão (HTTP 403). Cookies podem estar expirados.',
      ),
    ).toBe('cookie_expired');
    expect(classifyMlShortLinkError('API do Link Builder retornou HTTP 401')).toBe(
      'cookie_expired',
    );
    expect(classifyMlShortLinkError('Unauthorized')).toBe('cookie_expired');
    expect(classifyMlShortLinkError('Não autorizado')).toBe('cookie_expired');
  });

  it('marcadores de tag não associada (PT/ES/EN)', () => {
    expect(classifyMlShortLinkError('A tag não está associada ao afiliado')).toBe('tag_mismatch');
    expect(classifyMlShortLinkError('El tag no está asociado al afiliado')).toBe('tag_mismatch');
    expect(classifyMlShortLinkError('tag inválida')).toBe('tag_mismatch');
    expect(classifyMlShortLinkError('Tag no es válido')).toBe('tag_mismatch');
    expect(classifyMlShortLinkError('tag não existe')).toBe('tag_mismatch');
  });

  it('marcadores de produto inelegível / URL não permitida (PT/ES/EN)', () => {
    expect(classifyMlShortLinkError('URL not allowed in affiliates program')).toBe(
      'product_not_eligible',
    );
    expect(classifyMlShortLinkError('URL no permitida')).toBe('product_not_eligible');
    expect(classifyMlShortLinkError('URL não permitida para o programa')).toBe(
      'product_not_eligible',
    );
    expect(classifyMlShortLinkError('Produto não elegível no programa')).toBe(
      'product_not_eligible',
    );
    expect(classifyMlShortLinkError('El producto no es elegible')).toBe('product_not_eligible');
  });

  it('erros de rede', () => {
    expect(classifyMlShortLinkError('Erro ao obter CSRF token: fetch failed')).toBe('network');
    expect(classifyMlShortLinkError('fetch failed')).toBe('network');
    expect(classifyMlShortLinkError('NetworkError')).toBe('network');
  });

  it('mensagem sem marcadores → unknown', () => {
    expect(classifyMlShortLinkError('lorem ipsum dolor')).toBe('unknown');
    expect(classifyMlShortLinkError('')).toBe('unknown');
  });
});

describe('formatCreateLinkError', () => {
  it('109 → tag_mismatch com mensagem acionável + código', () => {
    const r = formatCreateLinkError(109, undefined);
    expect(r.kind).toBe('tag_mismatch');
    expect(r.message).toBe(`${ML_TAG_MISMATCH_MESSAGE} (código 109)`);
  });

  it('111 → product_not_eligible com mensagem acionável + código', () => {
    const r = formatCreateLinkError(111, undefined);
    expect(r.kind).toBe('product_not_eligible');
    expect(r.message).toBe(`${ML_PRODUCT_NOT_ELIGIBLE_MESSAGE} (código 111)`);
  });

  it('401 → cookie_expired com mensagem acionável + código', () => {
    const r = formatCreateLinkError(401, undefined);
    expect(r.kind).toBe('cookie_expired');
    expect(r.message).toBe(`${ML_COOKIE_EXPIRED_MESSAGE} (código 401)`);
  });

  it('sem código, mensagem "URL not allowed" → product_not_eligible sem sufixo', () => {
    const r = formatCreateLinkError(undefined, 'URL not allowed in affiliates program');
    expect(r.kind).toBe('product_not_eligible');
    expect(r.message).toBe(ML_PRODUCT_NOT_ELIGIBLE_MESSAGE);
  });

  it('sem código, mensagem espanhola de tag → tag_mismatch', () => {
    const r = formatCreateLinkError(undefined, 'El tag no está asociado al afiliado');
    expect(r.kind).toBe('tag_mismatch');
    expect(r.message).toBe(ML_TAG_MISMATCH_MESSAGE);
  });

  it('código desconhecido com mensagem → mantém mensagem, kind unknown', () => {
    const r = formatCreateLinkError(500, 'erro interno');
    expect(r.kind).toBe('unknown');
    expect(r.message).toBe('erro interno');
  });

  it('código desconhecido sem mensagem → fallback para código', () => {
    const r = formatCreateLinkError(500, undefined);
    expect(r.kind).toBe('unknown');
    expect(r.message).toBe('Erro do Link Builder: código 500');
  });
});

describe('parseCreateLinkResponse — errorKind', () => {
  it('error_code 109 → tag_mismatch com mensagem acionável', () => {
    const r = parseCreateLinkResponse({
      status: 200,
      urls: [{ error_code: 109 }],
    } as CreateLinkResponse);
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe('tag_mismatch');
    expect(r.error).toContain('Tag não associada ao afiliado');
    expect(r.error).toContain('código 109');
  });

  it('error_code 111 → product_not_eligible com mensagem acionável', () => {
    const r = parseCreateLinkResponse({
      status: 200,
      urls: [{ error_code: 111, message: 'URL not allowed in affiliates program' }],
    } as CreateLinkResponse);
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe('product_not_eligible');
    expect(r.error).toContain('Produto não elegível');
  });

  it('error_code 401 → cookie_expired', () => {
    const r = parseCreateLinkResponse({
      status: 200,
      urls: [{ error_code: 401, message: 'Unauthorized' }],
    } as CreateLinkResponse);
    expect(r.success).toBe(false);
    expect(r.errorKind).toBe('cookie_expired');
    expect(r.error).toContain('Cookies de sessão expirados');
  });

  it('sucesso → sem errorKind', () => {
    const r = parseCreateLinkResponse({
      status: 200,
      urls: [{ short_url: 'https://meli.la/abc' }],
    } as CreateLinkResponse);
    expect(r.success).toBe(true);
    expect(r.errorKind).toBeUndefined();
  });
});
