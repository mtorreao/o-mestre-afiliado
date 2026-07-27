/**
 * Testes do conversor de Mercado Livre.
 *
 * Cobre:
 *  - isMercadoLivreUrl: detecção de URL ML / meli.la
 *  - generateViaUrlParams: 3 formatos de fallback (meliid+melitat, simpleTag, matt_word)
 *  - mergeCookies: merge de cookies existentes com Set-Cookie
 *  - _testGenerateMetadataSessionId: formato do session id
 *  - convertMercadoLivreUrl: validação de URL não-ML
 */
import { describe, expect, it } from 'bun:test';
import {
  isMercadoLivreUrl,
  generateViaUrlParams,
  mergeCookies,
  convertMercadoLivreUrl,
} from './mercadolivre.ts';

describe('isMercadoLivreUrl', () => {
  it('detecta mercadolivre.com.br', () => {
    expect(isMercadoLivreUrl('https://www.mercadolivre.com.br/produto')).toBe(true);
  });

  it('detecta meli.la', () => {
    expect(isMercadoLivreUrl('https://meli.la/abc123')).toBe(true);
  });

  it('retorna false para amazon.com.br', () => {
    expect(isMercadoLivreUrl('https://www.amazon.com.br/dp/B07PXGQCK5')).toBe(false);
  });

  it('retorna false para shopee', () => {
    expect(isMercadoLivreUrl('https://shopee.com.br/product')).toBe(false);
  });

  it('retorna false para URL vazia', () => {
    expect(isMercadoLivreUrl('')).toBe(false);
  });
});

describe('generateViaUrlParams', () => {
  const baseUrl = 'https://www.mercadolivre.com.br/produto/MLB-123456';

  describe('formato antigo (meliid + melitat)', () => {
    it('adiciona meliid e melitat', () => {
      const result = generateViaUrlParams(baseUrl, {
        meliid: 'mtorreao1',
        melitat: 'om895584',
      });
      expect(result).toBe(`${baseUrl}?meliid=mtorreao1&melitat=om895584`);
    });
  });

  describe('formato simpleTag', () => {
    it('adiciona tag quando simpleTag está presente', () => {
      const result = generateViaUrlParams(baseUrl, {
        simpleTag: 'meuafiliado',
      });
      expect(result).toBe(`${baseUrl}?tag=meuafiliado`);
    });

    it('simpleTag tem prioridade quando não há meliid+melitat juntos', () => {
      const result = generateViaUrlParams(baseUrl, {
        melitat: 'so-melitat',
        simpleTag: 'tag-prioritaria',
      });
      expect(result).toBe(`${baseUrl}?tag=tag-prioritaria`);
    });
  });

  describe('formato novo (matt_word + matt_tool)', () => {
    it('adiciona matt_word e matt_tool quando só tem melitat', () => {
      const result = generateViaUrlParams(baseUrl, {
        melitat: 'mtorreao',
      });
      expect(result).toBe(`${baseUrl}?matt_word=mtorreao&matt_tool=71835809`);
    });
  });

  describe('preserva query params existentes', () => {
    it('mantém params da URL original junto com os novos', () => {
      const urlWithParams = `${baseUrl}?ref=origem`;
      const result = generateViaUrlParams(urlWithParams, {
        meliid: 'mtorreao1',
        melitat: 'om895584',
      });
      expect(result).toContain('ref=origem');
      expect(result).toContain('meliid=mtorreao1');
      expect(result).toContain('melitat=om895584');
    });
  });

  describe('validação', () => {
    it('lança erro quando nenhuma credencial de fallback é fornecida', () => {
      expect(() => generateViaUrlParams(baseUrl, {})).toThrow(/Nenhuma credencial/);
    });

    it('lança erro para creds vazio', () => {
      expect(() => generateViaUrlParams(baseUrl, { meliid: '', melitat: '' })).toThrow(
        /Nenhuma credencial/,
      );
    });
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
    // O valor do cookie deve ser só "xyz", sem os atributos
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

describe('convertMercadoLivreUrl — validação', () => {
  it('retorna erro quando URL não é do Mercado Livre', async () => {
    const result = await convertMercadoLivreUrl('https://shopee.com.br/product-xyz');
    expect(result.success).toBe(false);
    expect(result.marketplace).toBe('shopee');
    expect(result.error).toContain('URL não é do Mercado Livre');
  });

  it('retorna erro para URL vazia', async () => {
    const result = await convertMercadoLivreUrl('');
    expect(result.success).toBe(false);
    expect(result.error).toContain('URL não é do Mercado Livre');
  });
});
