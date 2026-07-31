/**
 * Testes do conversor de Magalu (camada I/O).
 *
 * Cobre:
 *   - convertMagaluUrlWithStoreSlug: detecção, validação de slug,
 *     resolução de shortlink, construção de URL
 *   - resolveMagaluShortlink: HEAD com 301/302, GET fallback, URL inválida
 *   - convertMagaluUrl: fallback .env MAGALU_STORE_NAME
 *
 * `fetch` é mockado via `globalThis.fetch` para isolar a rede.
 * Não exercita rede real (maga.lu → magazinevoce.com.br) porque o Magalu
 * retorna CAPTCHA para bots — esse caso fica para o teste E2E permanente
 * em `e2e/magalu.api.spec.ts` (futuro).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  convertMagaluUrl,
  convertMagaluUrlWithStoreSlug,
  resolveMagaluShortlink,
} from './magalu.ts';

// ─── Mocks de fetch ──────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface MockResponse {
  match: (url: string) => boolean;
  response: Response;
}

function mockFetchWithResponses(responses: MockResponse[]): void {
  const mocked = mock(async (input: unknown) => {
    const url = input instanceof Request ? input.url : String(input);
    const matched = responses.find((r) => r.match(url));
    if (!matched) {
      throw new Error(`mock fetch: nenhuma resposta configurada para ${url}`);
    }
    return matched.response;
  });
  globalThis.fetch = mocked as unknown as typeof fetch;
}

// ─── convertMagaluUrlWithStoreSlug ───────────────────────────────────

describe('convertMagaluUrlWithStoreSlug', () => {
  describe('happy path', () => {
    it('converte URL magazineluiza.com.br/<slug>/p/<ID>/ preservando slug', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/celular-x/p/12345/',
        'magazinetorre',
      );
      expect(result.success).toBe(true);
      expect(result.marketplace).toBe('magalu');
      expect(result.affiliateUrl).toBe(
        'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/',
      );
      expect(result.method).toBe('fallback');
    });

    it('usa placeholder determinístico para URL magazineluiza.com.br/p/<ID> sem slug', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/p/12345',
        'magazinetorre',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe(
        'https://www.magazinevoce.com.br/magazinetorre/produto-12345/p/12345/in/te/',
      );
    });

    it('preserva slugProduto/cat/subcat quando URL vem de Magazine Você', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazinevoce.com.br/outraloja/celular-x/p/eadk91754h/in/te/',
        'magazinetorre',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe(
        'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/eadk91754h/in/te/',
      );
    });

    it('aceita URL /oferta/<ID>/ preservando path completo (formato antigo)', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/samsung/divulgador/oferta/241149600/te/gs26/',
        'magazinetorre',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toContain('/oferta/241149600/');
    });
  });

  describe('validação de storeSlug', () => {
    it('retorna erro quando storeSlug é null', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/p/123/',
        null,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/slug/);
      expect(result.marketplace).toBe('magalu');
    });

    it('retorna erro quando storeSlug é undefined', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/p/123/',
        undefined,
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/slug/);
    });

    it('retorna erro quando storeSlug é vazio', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/p/123/',
        '',
      );
      expect(result.success).toBe(false);
    });

    it('retorna erro quando storeSlug tem maiúsculas', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/p/123/',
        'LojaComMaiuscula',
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/slug/i);
    });
  });

  describe('detecção de marketplace', () => {
    it('rejeita URL de outro marketplace', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.amazon.com.br/dp/B08N5WRWNW',
        'magazinetorre',
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('Magalu');
      expect(result.marketplace).toBe('amazon');
    });

    it('rejeita URL do Mercado Livre', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.mercadolivre.com.br/p/MLB123',
        'magazinetorre',
      );
      expect(result.success).toBe(false);
    });
  });

  describe('resolução de shortlinks', () => {
    it('resolve maga.lu/<id> via HEAD 302 → URL final (preserva slug)', async () => {
      mockFetchWithResponses([
        {
          match: (url) => url.includes('maga.lu/abc'),
          response: new Response(null, {
            status: 302,
            headers: { location: 'https://www.magazineluiza.com.br/celular-x/p/12345/' },
          }),
        },
      ]);
      const result = await convertMagaluUrlWithStoreSlug('https://maga.lu/abc', 'magazinetorre');
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe(
        'https://www.magazinevoce.com.br/magazinetorre/celular-x/p/12345/',
      );
      expect(result.method).toBe('api');
    });

    it('bloqueia shortlink que retorna 404', async () => {
      mockFetchWithResponses([
        {
          match: (url) => url.includes('maga.lu/notfound'),
          response: new Response('not found', { status: 404 }),
        },
      ]);
      const result = await convertMagaluUrlWithStoreSlug(
        'https://maga.lu/notfound',
        'magazinetorre',
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/shortlink maga\.lu/);
    });

    it('bloqueia shortlink que retorna Location ainda em maga.lu (loop)', async () => {
      mockFetchWithResponses([
        {
          match: (url) => url.includes('maga.lu/loop'),
          response: new Response(null, {
            status: 302,
            headers: { location: 'https://maga.lu/other' },
          }),
        },
      ]);
      const result = await convertMagaluUrlWithStoreSlug('https://maga.lu/loop', 'magazinetorre');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/shortlink maga\.lu/);
    });

    it('bloqueia shortlink que falha por erro de rede', async () => {
      const failingFetch = mock(async () => {
        throw new Error('network down');
      });
      globalThis.fetch = failingFetch as unknown as typeof fetch;
      const result = await convertMagaluUrlWithStoreSlug(
        'https://maga.lu/netfail',
        'magazinetorre',
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/shortlink maga\.lu/);
    });
  });

  describe('URL malformada', () => {
    it('bloqueia URL sem ID de produto após resolve', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://www.magazineluiza.com.br/',
        'magazinetorre',
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ID de produto Magalu/);
    });
  });

  describe('OneLink URL (já é link afiliado)', () => {
    it('reconhece OneLink como link já afiliado', async () => {
      const result = await convertMagaluUrlWithStoreSlug(
        'https://magazineluiza.onelink.me/589508454/qmpki3x1',
        'magazineogarimpeiro',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe('https://magazineluiza.onelink.me/589508454/qmpki3x1');
    });
  });

  describe('Promozone shortlinks', () => {
    it('resolve go.promozone.ai/magalu/<id> via HEAD 302 → URL final', async () => {
      mockFetchWithResponses([
        {
          match: (url) => url.includes('go.promozone.ai/magalu/abc'),
          response: new Response(null, {
            status: 302,
            headers: {
              location: 'https://www.magazineluiza.com.br/celular-x/p/12345/',
            },
          }),
        },
      ]);
      const result = await convertMagaluUrlWithStoreSlug(
        'https://go.promozone.ai/magalu/abc',
        'magazineogarimpeiro',
      );
      expect(result.success).toBe(true);
      expect(result.affiliateUrl).toBe(
        'https://www.magazinevoce.com.br/magazineogarimpeiro/celular-x/p/12345/',
      );
      expect(result.method).toBe('promozone');
    });

    it('bloqueia go.promozone.ai/magalu que não resolve', async () => {
      mockFetchWithResponses([
        {
          match: (url) => url.includes('go.promozone.ai/magalu/notfound'),
          response: new Response(null, { status: 404 }),
        },
      ]);
      const result = await convertMagaluUrlWithStoreSlug(
        'https://go.promozone.ai/magalu/notfound',
        'magazineogarimpeiro',
      );
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/go\.promozone\.ai/);
    });
  });
});

// ─── resolveMagaluShortlink isolado ─────────────────────────────────

describe('resolveMagaluShortlink', () => {
  it('retorna null para URL que não é shortlink Magalu', async () => {
    const result = await resolveMagaluShortlink('https://www.magazineluiza.com.br/p/123');
    expect(result).toBeNull();
  });

  it('segue 302 para Magazine Luiza', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('maga.lu/x'),
        response: new Response(null, {
          status: 302,
          headers: { location: 'https://www.magazineluiza.com.br/p/123/' },
        }),
      },
    ]);
    const result = await resolveMagaluShortlink('https://maga.lu/x');
    expect(result).toBe('https://www.magazineluiza.com.br/p/123/');
  });

  it('segue 301 para Magazine Você', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('maga.lu/y'),
        response: new Response(null, {
          status: 301,
          headers: { location: 'https://www.magazinevoce.com.br/loja/prod/p/123/in/te/' },
        }),
      },
    ]);
    const result = await resolveMagaluShortlink('https://maga.lu/y');
    expect(result).toBe('https://www.magazinevoce.com.br/loja/prod/p/123/in/te/');
  });

  it('retorna null para 404', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('maga.lu/nf'),
        response: new Response(null, { status: 404 }),
      },
    ]);
    const result = await resolveMagaluShortlink('https://maga.lu/nf');
    expect(result).toBeNull();
  });
});

// ─── convertMagaluUrl (fallback .env) ───────────────────────────────

describe('convertMagaluUrl (fallback .env)', () => {
  const originalEnv = process.env.MAGALU_STORE_NAME;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MAGALU_STORE_NAME;
    } else {
      process.env.MAGALU_STORE_NAME = originalEnv;
    }
  });

  it('usa MAGALU_STORE_NAME do env quando setado', async () => {
    process.env.MAGALU_STORE_NAME = 'magazinetorre';
    const result = await convertMagaluUrl('https://www.magazineluiza.com.br/p/123/');
    expect(result.success).toBe(true);
    expect(result.affiliateUrl).toContain('magazinevoce.com.br/magazinetorre/');
  });

  it('retorna erro quando MAGALU_STORE_NAME não está setado', async () => {
    delete process.env.MAGALU_STORE_NAME;
    const result = await convertMagaluUrl('https://www.magazineluiza.com.br/p/123/');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/slug/);
  });

  it('retorna erro quando MAGALU_STORE_NAME é inválido (ex: muito curto)', async () => {
    process.env.MAGALU_STORE_NAME = 'ab';
    const result = await convertMagaluUrl('https://www.magazineluiza.com.br/p/123/');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/mínimo 3/);
  });
});

// ─── generateMagaluOneLink ──────────────────────────────────────────

describe('generateMagaluOneLink', () => {
  // Import dynamically to avoid top-level side effects
  const { generateMagaluOneLink } = require('./magalu.ts') as typeof import('./magalu.ts');

  it('retorna OneLink quando API responde com shortenedLink', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('azion-rochelle-proxy/v1/shortenlink/onelink'),
        response: new Response(
          JSON.stringify({ shortenedLink: 'https://magazineluiza.onelink.me/abc/xyz' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      },
    ]);
    const result = await generateMagaluOneLink(
      'session=abc123',
      'https://www.magazineluiza.com.br/produto-x/p/12345/',
    );
    expect(result).toBe('https://magazineluiza.onelink.me/abc/xyz');
  });

  it('retorna null quando API responde sem shortenedLink', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('azion-rochelle-proxy'),
        response: new Response(JSON.stringify({}), { status: 200 }),
      },
    ]);
    const result = await generateMagaluOneLink(
      'session=abc',
      'https://www.magazineluiza.com.br/p/123/',
    );
    expect(result).toBeNull();
  });

  it('retorna null quando API retorna erro', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('azion-rochelle-proxy'),
        response: new Response('Unauthorized', { status: 401 }),
      },
    ]);
    const result = await generateMagaluOneLink(
      'session=invalid',
      'https://www.magazineluiza.com.br/p/123/',
    );
    expect(result).toBeNull();
  });

  it('retorna null quando fetch lança exceção', async () => {
    const failingFetch = mock(async () => {
      throw new Error('network error');
    });
    globalThis.fetch = failingFetch as unknown as typeof fetch;
    const result = await generateMagaluOneLink(
      'session=abc',
      'https://www.magazineluiza.com.br/p/123/',
    );
    expect(result).toBeNull();
  });

  it('substitui www por m. na URL mobile', async () => {
    let capturedBody: string | null = null;
    const capturingFetch = mock(async (input: unknown, init?: RequestInit) => {
      if (init?.body) capturedBody = init.body as string;
      return new Response(JSON.stringify({ shortenedLink: 'https://onelink.me/x' }), {
        status: 200,
      });
    });
    globalThis.fetch = capturingFetch as unknown as typeof fetch;
    await generateMagaluOneLink('s=x', 'https://www.magazineluiza.com.br/prod/p/123/');
    expect(capturedBody).not.toBeNull();
    const body = JSON.parse(capturedBody!);
    expect(body.link).toBe('https://m.magazineluiza.com.br/prod/p/123/');
    expect(body.desktopLink).toBe('https://www.magazineluiza.com.br/prod/p/123/');
  });
});

// ─── resolveMagaluShortlink GET fallback ─────────────────────────────

describe('resolveMagaluShortlink (GET fallback)', () => {
  it('usa GET quando HEAD retorna 200 (sem redirect)', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('maga.lu/head200'),
        response: new Response(null, { status: 200 }),
      },
      {
        match: (url) => url.includes('maga.lu/head200'),
        response: new Response(null, { status: 200 }),
      },
    ]);
    const result = await resolveMagaluShortlink('https://maga.lu/head200');
    // GET não retorna url diferente, então retorna null
    expect(result).toBeNull();
  });
});

// ─── resolvePromozoneMagaluUrl ───────────────────────────────────────

describe('resolvePromozoneMagaluUrl', () => {
  const { resolvePromozoneMagaluUrl } = require('./magalu.ts') as typeof import('./magalu.ts');

  it('resolve via HEAD 302', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('go.promozone.ai/magalu/test'),
        response: new Response(null, {
          status: 302,
          headers: { location: 'https://www.magazineluiza.com.br/prod/p/999/' },
        }),
      },
    ]);
    const result = await resolvePromozoneMagaluUrl('https://go.promozone.ai/magalu/test');
    expect(result).toBe('https://www.magazineluiza.com.br/prod/p/999/');
  });

  it('retorna null quando HEAD retorna 404', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('go.promozone.ai/magalu/nf'),
        response: new Response(null, { status: 404 }),
      },
    ]);
    const result = await resolvePromozoneMagaluUrl('https://go.promozone.ai/magalu/nf');
    expect(result).toBeNull();
  });

  it('retorna null para URL que não é Promozone', async () => {
    const result = await resolvePromozoneMagaluUrl('https://www.magazineluiza.com.br/p/123/');
    expect(result).toBeNull();
  });

  it('usa GET fallback quando HEAD retorna 200', async () => {
    mockFetchWithResponses([
      {
        match: (url) => url.includes('go.promozone.ai/magalu/head200'),
        response: new Response(null, { status: 200 }),
      },
    ]);
    const result = await resolvePromozoneMagaluUrl('https://go.promozone.ai/magalu/head200');
    expect(result).toBeNull();
  });

  it('retorna null quando fetch falha', async () => {
    const failingFetch = mock(async () => {
      throw new Error('network');
    });
    globalThis.fetch = failingFetch as unknown as typeof fetch;
    const result = await resolvePromozoneMagaluUrl('https://go.promozone.ai/magalu/fail');
    expect(result).toBeNull();
  });
});
