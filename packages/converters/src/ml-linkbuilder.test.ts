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
import { generateShortAffiliateLink, _testResetCsrfCache } from './ml-linkbuilder.ts';
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
    // Cache de CSRF é módulo-global — zera entre testes para isolamento.
    _testResetCsrfCache();
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

describe('generateShortAffiliateLink — renovação automática de cookies', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    _testResetCsrfCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const PAGE_HTML = '<html><meta name="csrf-token" content="TOKEN1"></html>';
  const OK_RESP = { urls: [{ short_url: 'https://meli.la/x1', long_url: 'https://prod' }] };

  function setCookieResponse(setCookies: string[], status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { getSetCookie: () => setCookies, get: () => null },
      text: async () => '',
    } as unknown as Response;
  }

  it('401 no createLink renova cookies via set-cookie e refaz com sucesso', async () => {
    let apiCalls = 0;
    let pageCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) {
        apiCalls += 1;
        if (apiCalls === 1) return jsonResponse({}, false, 401);
        return jsonResponse(OK_RESP);
      }
      if (url === PAGE_URL) {
        pageCalls += 1;
        // 1º: CSRF com cookies antigos | 2º: GET de renovação | 3º: CSRF com cookies novos
        if (pageCalls === 1) return jsonResponse(PAGE_HTML, true, 200);
        if (pageCalls === 2) return setCookieResponse(['session=new; Path=/']);
        return jsonResponse(PAGE_HTML, true, 200);
      }
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'session=old');
    expect(r.success).toBe(true);
    expect(r.shortUrl).toBe('https://meli.la/x1');
    expect(apiCalls).toBe(2); // 1º 401 → renovou → 2º sucesso
    expect(r.renewedCookies).toContain('session=new');
  });

  it('401 sem set-cookie na renovação → erro com marcador de cookie expirado', async () => {
    let apiCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) {
        apiCalls += 1;
        return jsonResponse({}, false, 401);
      }
      if (url === PAGE_URL) return jsonResponse(PAGE_HTML, true, 200);
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'session=old');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Não foi possível renovar');
    expect(r.error).toContain('HTTP 401');
    expect(r.error).toContain('Cookies podem estar expirados'); // fallback URL params
    expect(apiCalls).toBe(1); // sem renovação, não refaz
  });

  it('403 no retry do createLink após renovação → erro de renovação', async () => {
    let apiCalls = 0;
    let pageCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) {
        apiCalls += 1;
        return jsonResponse({}, false, 403);
      }
      if (url === PAGE_URL) {
        pageCalls += 1;
        if (pageCalls === 1) return jsonResponse(PAGE_HTML, true, 200);
        if (pageCalls === 2) return setCookieResponse(['session=new; Path=/']);
        return jsonResponse(PAGE_HTML, true, 200);
      }
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'session=old');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Não foi possível renovar');
    expect(r.error).toContain('HTTP 403');
    expect(apiCalls).toBe(2); // tentou renovar e refazer, mas 403 persiste
  });

  it('renovação no GET da página (401) → refaz CSRF e converte', async () => {
    let pageCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) return jsonResponse(OK_RESP);
      if (url === PAGE_URL) {
        pageCalls += 1;
        if (pageCalls === 1) return jsonResponse('', false, 401);
        if (pageCalls === 2) return setCookieResponse(['session=new; Path=/']);
        return jsonResponse(PAGE_HTML, true, 200);
      }
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'session=old');
    expect(r.success).toBe(true);
    expect(r.shortUrl).toBe('https://meli.la/x1');
    expect(pageCalls).toBe(3);
    expect(r.renewedCookies).toContain('session=new');
  });

  it('página sem CSRF + renovação com set-cookie → recupera e converte', async () => {
    let pageCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) return jsonResponse(OK_RESP);
      if (url === PAGE_URL) {
        pageCalls += 1;
        if (pageCalls === 1) return jsonResponse('<html>página de login</html>', true, 200);
        if (pageCalls === 2) return setCookieResponse(['session=new; Path=/']);
        return jsonResponse(PAGE_HTML, true, 200);
      }
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'session=old');
    expect(r.success).toBe(true);
    expect(r.shortUrl).toBe('https://meli.la/x1');
    expect(pageCalls).toBe(3);
  });

  it('página sem CSRF e renovação sem set-cookie → CSRF_NOT_FOUND', async () => {
    const fetchMock = mock(async (url: string) => {
      if (url === PAGE_URL) return jsonResponse('<html>página de login</html>', true, 200);
      return jsonResponse({}, false, 500);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r = await generateShortAffiliateLink('https://prod', 'mytag', 'session=old');
    expect(r.success).toBe(false);
    expect(r.error).toBe(CSRF_NOT_FOUND_MESSAGE);
  });
});

describe('generateShortAffiliateLink — cache de CSRF por afiliado', () => {
  let originalFetch: typeof fetch;

  const PAGE_HTML = '<html><meta name="csrf-token" content="TOKEN1"></html>';
  const OK_RESP = { urls: [{ short_url: 'https://meli.la/x1', long_url: 'https://prod' }] };

  function setCookieResponse(setCookies: string[], status = 200) {
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { getSetCookie: () => setCookies, get: () => null },
      text: async () => '',
    } as unknown as Response;
  }

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    _testResetCsrfCache();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('segunda chamada consecutiva com mesmos cookies faz só 1 request (POST)', async () => {
    let pageCalls = 0;
    let apiCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) {
        apiCalls += 1;
        return jsonResponse({ urls: [{ short_url: 'https://meli.la/x1' }] });
      }
      if (url === PAGE_URL) {
        pageCalls += 1;
        return jsonResponse('<html><meta name="csrf-token" content="TOKEN1"></html>', true, 200);
      }
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r1 = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r1.success).toBe(true);
    expect(pageCalls).toBe(1);
    expect(apiCalls).toBe(1);

    const r2 = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    expect(r2.success).toBe(true);
    expect(pageCalls).toBe(1); // GET da página NÃO repetiu
    expect(apiCalls).toBe(2);
    expect(r2.renewedCookies).toBeUndefined();
  });

  it('cookies diferentes → cache não reutiliza CSRF (GET refeito)', async () => {
    let pageCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) return jsonResponse({ urls: [{ short_url: 'https://meli.la/x1' }] });
      if (url === PAGE_URL) {
        pageCalls += 1;
        return jsonResponse('<html><meta name="csrf-token" content="TOKEN1"></html>', true, 200);
      }
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=1');
    const r2 = await generateShortAffiliateLink('https://prod', 'mytag', 'cookie=2');
    expect(r2.success).toBe(true);
    expect(pageCalls).toBe(2); // fingerprint mudou → novo GET
  });

  it('401 invalida o cache e renova a sessão na mesma chamada', async () => {
    let apiCalls = 0;
    let pageCalls = 0;
    const fetchMock = mock(async (url: string) => {
      if (url === API_URL) {
        apiCalls += 1;
        if (apiCalls === 1) return jsonResponse({}, false, 401); // sessão morreu
        return jsonResponse({ urls: [{ short_url: 'https://meli.la/x1' }] });
      }
      if (url === PAGE_URL) {
        pageCalls += 1;
        // 1º: CSRF inicial | 2º: renovação | 3º: CSRF pós-renovação
        if (pageCalls === 1) return jsonResponse(PAGE_HTML, true, 200);
        if (pageCalls === 2) return setCookieResponse(['session=new; Path=/']);
        return jsonResponse(PAGE_HTML, true, 200);
      }
      return jsonResponse({}, false, 404);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const r1 = await generateShortAffiliateLink('https://prod', 'mytag', 'session=old');
    expect(r1.success).toBe(true); // renovou e converteu
    expect(pageCalls).toBe(3);
    expect(r1.renewedCookies).toContain('session=new');
  });
});
