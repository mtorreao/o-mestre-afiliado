/**
 * Testes do I/O orchestrator do Link Builder ML (ml-linkbuilder.ts).
 *
 * Cobre TODOS os branchs de generateShortAffiliateLink via fetch mockado:
 *  - GET da página: ok + csrf, not-ok (page error), sem csrf, exceção
 *  - POST createLink: ok + short_url, not-ok (api error), error_code,
 *    sem short_url, json malformado (catch)
 *
 * O SHA256 não se aplica aqui; mantemos os mesmos headers/cookies da
 * implementação. O prefixo/assinatura SHA-256 é exclusivo da Shopee.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { generateShortAffiliateLink } from './ml-linkbuilder.ts';
import {
  CSRF_NOT_FOUND_MESSAGE,
  EMPTY_URLS_MESSAGE,
  MISSING_SHORT_URL_MESSAGE,
} from './ml-linkbuilder-pure.ts';

const PAGE_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';
const API_URL = 'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';

function jsonResponse(obj: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
    json: async () => obj,
  } as unknown as Response;
}

describe('generateShortAffiliateLink', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sucesso: extrai csrf da página e cria link', async () => {
    const html = '<html><meta name="csrf-token" content="TOKEN123"></html>';
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse(html, true, 200);
      if (url === API_URL)
        return jsonResponse({
          urls: [{ short_url: 'https://meli.la/x1', long_url: 'https://prod' }],
        });
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(true);
    expect(r.shortUrl).toBe('https://meli.la/x1');
  });

  it('erro de página (HTTP não-ok)', async () => {
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse('', false, 403);
      return jsonResponse({}, false, 500);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Falha ao acessar Link Builder: HTTP 403');
  });

  it('erro quando não há CSRF token na página', async () => {
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse('<html>sem meta</html>', true, 200);
      return jsonResponse({}, false, 500);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toBe(CSRF_NOT_FOUND_MESSAGE);
  });

  it('erro quando o fetch do CSRF lança exceção', async () => {
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) throw new Error('network down');
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Erro ao obter CSRF token: network down');
  });

  it('erro de API (HTTP não-ok no POST)', async () => {
    const html = '<html><meta name="csrf-token" content="TOKEN123"></html>';
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse(html, true, 200);
      if (url === API_URL) return jsonResponse({}, false, 500);
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('API do Link Builder retornou HTTP 500');
  });

  it('erro interno (error_code) na resposta', async () => {
    const html = '<html><meta name="csrf-token" content="TOKEN123"></html>';
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse(html, true, 200);
      if (url === API_URL)
        return jsonResponse({ urls: [{ error_code: 400, message: 'tag inválida' }] });
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('tag inválida');
  });

  it('erro quando API não retorna short_url', async () => {
    const html = '<html><meta name="csrf-token" content="TOKEN123"></html>';
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse(html, true, 200);
      if (url === API_URL) return jsonResponse({ urls: [{ long_url: 'https://prod' }] });
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toBe(MISSING_SHORT_URL_MESSAGE);
  });

  it('erro quando API retorna sem urls', async () => {
    const html = '<html><meta name="csrf-token" content="TOKEN123"></html>';
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse(html, true, 200);
      if (url === API_URL) return jsonResponse({});
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toBe(EMPTY_URLS_MESSAGE);
  });

  it('erro quando o json da resposta da API lança (catch geral)', async () => {
    const html = '<html><meta name="csrf-token" content="TOKEN123"></html>';
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse(html, true, 200);
      if (url === API_URL) {
        return {
          ok: true,
          status: 200,
          json: async () => {
            throw new Error('bad json');
          },
        } as unknown as Response;
      }
      return jsonResponse({});
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('bad json');
  });
});
