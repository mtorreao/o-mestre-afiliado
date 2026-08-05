/**
 * Testes de I/O (fetch mockado) dos orquestradores de Mercado Livre e Shopee.
 *
 * Cobre os branchs de rede que antes ficavam sem cobertura:
 *  - mercadolivre: getAccessToken (sucesso/erro não-ok), generateViaApi
 *    (sucesso/erro/sem shorten_url), generateViaCookies (sem cookies,
 *    redirect de login, html sem link, meli.la solto), refreshSessionCookies
 *    (sem cookies, com set-cookie), convertMercadoLivreUrlWithToken
 *  - shopee: generateShortLink (sucesso/erro GraphQL/sem shortLink),
 *    getProductOffer (itemId+shopId, keyword, nenhum) via shopeeGraphqlRequest
 *
 * O prefixo SHA256 da Shopee permanece inalterado — os headers de auth são
 * validados nos testes de shopee-pure/helpers.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  convertMercadoLivreUrl,
  convertMercadoLivreUrlWithToken,
  generateViaApi,
  generateViaCookies,
  getAccessToken,
  refreshSessionCookies,
} from './mercadolivre.ts';
import { generateShortLink, getProductOffer } from './shopee.ts';
import type { ShopeeCredentials } from './shopee-pure.ts';

function jsonResponse(obj: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => (typeof obj === 'string' ? obj : JSON.stringify(obj)),
    json: async () => obj,
    url: 'https://x',
  } as unknown as Response;
}

function redirectResponse(location: string, status: number) {
  return {
    ok: false,
    status,
    headers: { get: (h: string) => (h === 'location' ? location : null) },
    text: async () => '',
  } as unknown as Response;
}

describe('mercadolivre — getAccessToken', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => (originalFetch = globalThis.fetch));
  afterEach(() => (globalThis.fetch = originalFetch));

  it('obtém access_token via refresh_token', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        access_token: 'AT',
        refresh_token: 'RT',
        expires_in: 1,
        token_type: 'bearer',
      }),
    ) as unknown as typeof fetch;

    const r = await getAccessToken('cid', 'csec', undefined, undefined, 'rtok');
    expect(r.access_token).toBe('AT');
  });

  it('lança quando resposta não-ok', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ message: 'invalid_grant' }, false, 400),
    ) as unknown as typeof fetch;

    await expect(getAccessToken('cid', 'csec', undefined, undefined, 'rtok')).rejects.toThrow(
      /OAuth erro 400: invalid_grant/,
    );
  });
});

describe('mercadolivre — generateViaApi', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => (originalFetch = globalThis.fetch));
  afterEach(() => (globalThis.fetch = originalFetch));

  it('retorna shorten_url em sucesso', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ shorten_url: 'https://meli.la/z', long_url: 'https://p', status: 'OK' }),
    ) as unknown as typeof fetch;
    expect(await generateViaApi('https://p', 'tok')).toBe('https://meli.la/z');
  });

  it('lança em erro HTTP', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse('rate limit', false, 429),
    ) as unknown as typeof fetch;
    await expect(generateViaApi('https://p', 'tok')).rejects.toThrow(/ML API erro 429/);
  });

  it('lança quando não há shorten_url', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ long_url: 'https://p', status: 'OK' }),
    ) as unknown as typeof fetch;
    await expect(generateViaApi('https://p', 'tok')).rejects.toThrow(/não retornou shorten_url/);
  });

  it('URL not allowed (produto inelegível) → mensagem acionável', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ message: 'URL not allowed in affiliates program' }, false, 400),
    ) as unknown as typeof fetch;
    await expect(generateViaApi('https://p', 'tok')).rejects.toThrow(
      'Produto não elegível no programa de afiliados do Mercado Livre',
    );
  });

  it('tag não associada (ES) → mensagem acionável', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ message: 'El tag no está asociado al afiliado' }, false, 400),
    ) as unknown as typeof fetch;
    await expect(generateViaApi('https://p', 'tok')).rejects.toThrow(
      'Tag não associada ao afiliado',
    );
  });

  it('erro HTTP sem marcador → mensagem original (fallback de estratégia)', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse('rate limit', false, 429),
    ) as unknown as typeof fetch;
    await expect(generateViaApi('https://p', 'tok')).rejects.toThrow(/ML API erro 429/);
  });
});

describe('mercadolivre — generateViaCookies', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => (originalFetch = globalThis.fetch));
  afterEach(() => (globalThis.fetch = originalFetch));

  it('retorna null sem cookies', async () => {
    expect(await generateViaCookies('https://p', undefined)).toBeNull();
  });

  it('retorna null em redirect de login (cookies expirados)', async () => {
    globalThis.fetch = mock(async () =>
      redirectResponse('https://www.mercadolivre.com.br/login?x=1', 302),
    ) as unknown as typeof fetch;
    expect(await generateViaCookies('https://p', 'ck')).toBeNull();
  });

  it('extrai meli.la solto do html', async () => {
    const html = 'veja meli.la/ABC123 aqui';
    globalThis.fetch = mock(async () => jsonResponse(html)) as unknown as typeof fetch;
    expect(await generateViaCookies('https://p', 'ck')).toBe('https://meli.la/ABC123');
  });

  it('retorna null quando html não tem link', async () => {
    globalThis.fetch = mock(async () => jsonResponse('sem link')) as unknown as typeof fetch;
    expect(await generateViaCookies('https://p', 'ck')).toBeNull();
  });
});

describe('mercadolivre — refreshSessionCookies', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => (originalFetch = globalThis.fetch));
  afterEach(() => (globalThis.fetch = originalFetch));

  it('retorna vazio sem cookies atuais', async () => {
    expect(await refreshSessionCookies(undefined)).toBe('');
  });

  it('mescla set-cookie quando presente', async () => {
    globalThis.fetch = mock(async () => ({
      headers: { get: (h: string) => (h === 'set-cookie' ? 'csrftoken=new' : null) },
    })) as unknown as typeof fetch;
    const merged = await refreshSessionCookies('session=old');
    expect(merged).toContain('session=old');
    expect(merged).toContain('csrftoken=new');
  });

  it('mantém cookies quando não há set-cookie', async () => {
    globalThis.fetch = mock(async () => ({
      headers: { get: () => null },
    })) as unknown as typeof fetch;
    expect(await refreshSessionCookies('session=old')).toBe('session=old');
  });

  it('mescla múltiplos set-cookie via getSetCookie', async () => {
    globalThis.fetch = mock(async () => ({
      headers: { getSetCookie: () => ['csrftoken=new; Path=/', 'session_id=abc'] },
    })) as unknown as typeof fetch;
    const merged = await refreshSessionCookies('session=old');
    expect(merged).toContain('session=old');
    expect(merged).toContain('csrftoken=new');
    expect(merged).toContain('session_id=abc');
  });
});

describe('mercadolivre — convertMercadoLivreUrlWithToken', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => (originalFetch = globalThis.fetch));
  afterEach(() => (globalThis.fetch = originalFetch));

  it('converte via API com token explícito', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ shorten_url: 'https://meli.la/w', long_url: 'https://p', status: 'OK' }),
    ) as unknown as typeof fetch;
    const r = await convertMercadoLivreUrlWithToken('https://www.mercadolivre.com.br/p', 'tok');
    expect(r.success).toBe(true);
    expect(r.affiliateUrl).toBe('https://meli.la/w');
    expect(r.method).toBe('api');
  });

  it('retorna erro quando token inválido (HTTP não-ok)', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse('forbidden', false, 403),
    ) as unknown as typeof fetch;
    const r = await convertMercadoLivreUrlWithToken('https://www.mercadolivre.com.br/p', 'tok');
    expect(r.success).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('retorna erro para URL não-ML', async () => {
    const r = await convertMercadoLivreUrlWithToken('https://shopee.com.br/p', 'tok');
    expect(r.success).toBe(false);
    expect(r.error).toContain('URL não é do Mercado Livre');
  });
});

describe('shopee — generateShortLink', () => {
  let originalFetch: typeof fetch;
  const originalEnv = process.env.SHOPEE_APP_ID;
  const originalSecret = process.env.SHOPEE_SECRET;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env.SHOPEE_APP_ID = 'app';
    process.env.SHOPEE_SECRET = 'sec';
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env.SHOPEE_APP_ID = originalEnv;
    process.env.SHOPEE_SECRET = originalSecret;
  });

  it('retorna shortLink em sucesso', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ data: { generateShortLink: { shortLink: 'https://shp.ee/abc' } } }),
    ) as unknown as typeof fetch;
    expect(await generateShortLink('https://shopee.com.br/x-i.1.2')).toBe('https://shp.ee/abc');
  });

  it('lança em erro GraphQL', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ errors: [{ message: 'invalid app id' }] }),
    ) as unknown as typeof fetch;
    await expect(generateShortLink('https://shopee.com.br/x-i.1.2')).rejects.toThrow(
      /invalid app id/,
    );
  });

  it('retorna null quando não há shortLink nem errors', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ data: { generateShortLink: null } }),
    ) as unknown as typeof fetch;
    expect(await generateShortLink('https://shopee.com.br/x-i.1.2')).toBeNull();
  });
});

describe('shopee — getProductOffer', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => (originalFetch = globalThis.fetch));
  afterEach(() => (globalThis.fetch = originalFetch));

  const creds: ShopeeCredentials = { appId: 'a', secret: 'b' };

  it('retorna oferta via itemId+shopId', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: { productOfferV2: { nodes: [{ itemId: 2, shopId: 1, productName: 'X' }] } },
      }),
    ) as unknown as typeof fetch;
    const r = await getProductOffer('https://shopee.com.br/Prod-i.1.2', creds);
    expect(r?.itemId).toBe(2);
    expect(r?.shopId).toBe(1);
  });

  it('cai no fallback por keyword quando itemId+shopId não acham', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        data: { productOfferV2: { nodes: [{ itemId: 9, shopId: 8, productName: 'Y' }] } },
      }),
    ) as unknown as typeof fetch;
    const r = await getProductOffer('https://shopee.com.br/Meu-Produto', creds);
    expect(r?.itemId).toBe(9);
  });

  it('retorna null quando nenhuma estratégia acha oferta', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({ data: { productOfferV2: { nodes: [] } } }),
    ) as unknown as typeof fetch;
    const r = await getProductOffer('https://shopee.com.br/Meu-Produto', creds);
    expect(r).toBeNull();
  });

  it('retorna null quando shopeeGraphqlRequest falha (resposta não-ok)', async () => {
    globalThis.fetch = mock(async () => jsonResponse({}, false, 500)) as unknown as typeof fetch;
    const r = await getProductOffer('https://shopee.com.br/Prod-i.1.2', creds);
    expect(r).toBeNull();
  });
});

describe('mercadolivre — convertMercadoLivreUrl (orquestração)', () => {
  let originalFetch: typeof fetch;
  const savedEnv = { ...process.env };
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    process.env = { ...savedEnv };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...savedEnv };
  });

  it('fallback via URL params quando só há credenciais de fallback', async () => {
    process.env.ML_MELIID = 'mid';
    process.env.ML_MELITAT = 'mat';
    const r = await convertMercadoLivreUrl('https://www.mercadolivre.com.br/prod/MLB-1', {
      prefer: ['fallback'],
    });
    expect(r.success).toBe(true);
    expect(r.method).toBe('fallback');
    expect(r.affiliateUrl).toContain('meliid=mid');
  });

  it('estratégia api: usa getAccessToken + generateViaApi', async () => {
    process.env.ML_CLIENT_ID = 'cid';
    process.env.ML_CLIENT_SECRET = 'csec';
    process.env.ML_REFRESH_TOKEN = 'rtok';
    globalThis.fetch = mock(async (url: string) => {
      if (String(url).includes('/oauth/token'))
        return jsonResponse({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 1,
          token_type: 'bearer',
        });
      return jsonResponse({ shorten_url: 'https://meli.la/api', long_url: 'u', status: 'OK' });
    }) as unknown as typeof fetch;
    const r = await convertMercadoLivreUrl('https://www.mercadolivre.com.br/prod/MLB-1');
    expect(r.success).toBe(true);
    expect(r.method).toBe('api');
    expect(r.affiliateUrl).toBe('https://meli.la/api');
  });

  it('nenhuma estratégia disponível (sem credenciais) → falha', async () => {
    // sem credenciais de api/cookies/fallback no env
    const r = await convertMercadoLivreUrl('https://www.mercadolivre.com.br/prod/MLB-1');
    expect(r.success).toBe(false);
    expect(r.affiliateUrl).toBeNull();
    expect(r.method).toBe('unknown');
  });

  it('retorna erro para URL não-ML', async () => {
    const r = await convertMercadoLivreUrl('https://amazon.com.br/dp/X');
    expect(r.success).toBe(false);
    expect(r.error).toContain('URL não é do Mercado Livre');
  });

  it('api rejeita URL (produto inelegível) → erro acionável SEM fallback params', async () => {
    process.env.ML_CLIENT_ID = 'cid';
    process.env.ML_CLIENT_SECRET = 'csec';
    process.env.ML_REFRESH_TOKEN = 'rtok';
    process.env.ML_MELIID = 'mid';
    process.env.ML_MELITAT = 'mat';
    let calls = 0;
    globalThis.fetch = mock(async (url: string) => {
      calls++;
      if (String(url).includes('/oauth/token'))
        return jsonResponse({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 1,
          token_type: 'bearer',
        });
      return jsonResponse({ message: 'URL not allowed in affiliates program' }, false, 400);
    }) as unknown as typeof fetch;

    const r = await convertMercadoLivreUrl('https://www.mercadolivre.com.br/prod/MLB-1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Produto não elegível');
    expect(r.method).toBe('unknown');
    // Sem fallback silencioso: só OAuth + Link Builder foram chamados.
    expect(calls).toBe(2);
  });

  it('api com 401 (não autorizado) → cai no fallback de URL params', async () => {
    process.env.ML_CLIENT_ID = 'cid';
    process.env.ML_CLIENT_SECRET = 'csec';
    process.env.ML_REFRESH_TOKEN = 'rtok';
    process.env.ML_MELIID = 'mid';
    process.env.ML_MELITAT = 'mat';
    globalThis.fetch = mock(async (url: string) => {
      if (String(url).includes('/oauth/token'))
        return jsonResponse({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 1,
          token_type: 'bearer',
        });
      return jsonResponse('Unauthorized', false, 401);
    }) as unknown as typeof fetch;

    const r = await convertMercadoLivreUrl('https://www.mercadolivre.com.br/prod/MLB-1', {
      prefer: ['api', 'cookies', 'fallback'],
    });
    expect(r.success).toBe(true);
    expect(r.method).toBe('fallback');
    expect(r.affiliateUrl).toContain('meliid=mid');
  });

  it('resolve link curto meli.la e converte via api', async () => {
    process.env.ML_CLIENT_ID = 'cid';
    process.env.ML_CLIENT_SECRET = 'csec';
    process.env.ML_REFRESH_TOKEN = 'rtok';
    let call = 0;
    globalThis.fetch = mock(async (url: string) => {
      call++;
      const u = String(url);
      if (u.includes('/oauth/token'))
        return jsonResponse({
          access_token: 'AT',
          refresh_token: 'RT',
          expires_in: 1,
          token_type: 'bearer',
        });
      if (u.startsWith('https://meli.la/')) {
        // resolveShortUrl faz HEAD → location
        return {
          ok: false,
          status: 301,
          headers: { get: () => 'https://www.mercadolivre.com.br/prod/MLB-9' },
        } as unknown as Response;
      }
      return jsonResponse({ shorten_url: 'https://meli.la/resolved', long_url: 'u', status: 'OK' });
    }) as unknown as typeof fetch;
    const r = await convertMercadoLivreUrl('https://meli.la/abc123');
    expect(r.success).toBe(true);
    expect(r.affiliateUrl).toBe('https://meli.la/resolved');
  });
});
