/**
 * Testes unitários para @omestre/shared/src/offer-validator.ts
 *
 * Funções testadas:
 *   ✅ extractUrls()          — Extrai URLs de texto
 *   ✅ isKnownMarketplaceDomain() — Detecção de domínios de marketplace/encurtador
 *   ✅ resolveUrl()           — Segue redirecionamentos HTTP
 *   ✅ isMessageValidOffer()  — Valida se mensagem contém oferta
 *   ✅ validateGroup()        — Valida grupo de ofertas
 *   ✅ validateOfferGroups()  — Relatório consolidado de múltiplos grupos
 *
 * Estratégia:
 *   - Mock global fetch para testes de resolução de URL
 *   - validateGroup/validateOfferGroups recebem fetchGroupMessages como parâmetro
 *   - Testes 100% isolados, sem dependência de rede
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

interface FakeMessage {
  text?: string;
  timestamp?: number;
}

interface FetchMessagesResult {
  success: boolean;
  messages?: FakeMessage[];
  error?: string;
}

const mockFetchGroupMessages = mock<
  (instanceName: string, groupJid: string, limit?: number) => Promise<FetchMessagesResult>
>(() => Promise.resolve({ success: true, messages: [] }));

// ══════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════

function makeMockResponse(finalUrl: string): Response {
  return {
    url: finalUrl,
    body: { cancel: () => {} },
  } as unknown as Response;
}

const MARKETPLACE_URL = 'https://shopee.com.br/product/123';
const SHORTENER_URL = 'https://shp.ee/abc123';
const GENERIC_URL = 'https://example.com/page';

// ══════════════════════════════════════════════════════════════════════
// TESTES
// ══════════════════════════════════════════════════════════════════════

describe('offerValidator', () => {
  beforeAll(() => {
    mock.restore();
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    mockFetchGroupMessages.mockReset();
    mockFetchGroupMessages.mockImplementation(() =>
      Promise.resolve({ success: true, messages: [] }),
    );
  });

  // ══════════════════════════════════════════════════════════════════
  // extractUrls()
  // ══════════════════════════════════════════════════════════════════

  describe('extractUrls()', () => {
    it('extrai URLs https de texto simples', async () => {
      const { extractUrls } = await import('@omestre/shared');
      expect(extractUrls('Confira https://shopee.com.br/product/123')).toEqual([
        'https://shopee.com.br/product/123',
      ]);
    });

    it('extrai URLs http de texto', async () => {
      const { extractUrls } = await import('@omestre/shared');
      expect(extractUrls('Link: http://meli.la/produto')).toEqual([
        'http://meli.la/produto',
      ]);
    });

    it('retorna array vazio para texto sem URLs', async () => {
      const { extractUrls } = await import('@omestre/shared');
      expect(extractUrls('Apenas texto sem links')).toEqual([]);
    });

    it('retorna array vazio para string vazia', async () => {
      const { extractUrls } = await import('@omestre/shared');
      expect(extractUrls('')).toEqual([]);
    });

    it('deduplica URLs mantendo ordem de aparição', async () => {
      const { extractUrls } = await import('@omestre/shared');
      const result = extractUrls(
        'A: https://shopee.com.br/a B: https://shopee.com.br/b A: https://shopee.com.br/a',
      );
      expect(result).toEqual([
        'https://shopee.com.br/a',
        'https://shopee.com.br/b',
      ]);
    });

    it('extrai URLs com query params e fragmentos', async () => {
      const { extractUrls } = await import('@omestre/shared');
      const result = extractUrls(
        'https://shopee.com.br/p?q=test&page=1#section',
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('q=test');
      expect(result[0]).toContain('#section');
    });

    it('extrai URLs com caracteres especiais no path', async () => {
      const { extractUrls } = await import('@omestre/shared');
      const result = extractUrls(
        'https://mercadolivre.com.br/MLB-1234567890-item-_JM',
      );
      expect(result).toHaveLength(1);
    });

    it('retorna múltiplas URLs distintas', async () => {
      const { extractUrls } = await import('@omestre/shared');
      const result = extractUrls(
        'Shopee: https://shopee.com.br/a e Amazon: https://amazon.com.br/b',
      );
      expect(result).toHaveLength(2);
    });

    it('ignora texto sem protocolo (apenas www)', async () => {
      const { extractUrls } = await import('@omestre/shared');
      expect(extractUrls('Visite www.exemplo.com')).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // isKnownMarketplaceDomain()
  // ══════════════════════════════════════════════════════════════════

  describe('isKnownMarketplaceDomain()', () => {
    it('retorna true para Shopee', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://shopee.com.br/produto')).toBe(
        true,
      );
    });

    it('retorna true para Mercado Livre', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(
        isKnownMarketplaceDomain('https://mercadolivre.com.br/item'),
      ).toBe(true);
    });

    it('retorna true para Amazon', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://amazon.com.br/dp/123')).toBe(
        true,
      );
    });

    it('retorna true para meli.la', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://meli.la/123')).toBe(true);
    });

    it('retorna true para amzn.to', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://amzn.to/abc')).toBe(true);
    });

    it('retorna true para shp.ee', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://shp.ee/xyz')).toBe(true);
    });

    it('retorna true para go.promozone.ai', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://go.promozone.ai/shopee/abc')).toBe(
        true,
      );
    });

    it('retorna true para magalu.com.br', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://magalu.com.br/produto')).toBe(
        true,
      );
    });

    it('retorna true para maga.lu (encurtador Magalu)', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://maga.lu/abc123')).toBe(true);
    });

    it('retorna true para go.promozone.ai/magalu', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://go.promozone.ai/magalu/prod')).toBe(
        true,
      );
    });

    it('retorna true para s.shopee.com.br', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://s.shopee.com.br/link')).toBe(
        true,
      );
    });

    it('retorna true para bit.ly', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://bit.ly/3abc')).toBe(true);
    });

    it('retorna true para tinyurl.com', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://tinyurl.com/abc')).toBe(true);
    });

    it('retorna true para vtao.com', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://vtao.com/link')).toBe(true);
    });

    it('retorna true para shortlink.*', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://shortlink.test/xyz')).toBe(true);
    });

    it('retorna true para app.mktplc.*', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://app.mktplc.test/link')).toBe(
        true,
      );
    });

    it('retorna true para mercadoenvios.com.br', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(
        isKnownMarketplaceDomain('https://mercadoenvios.com.br/envio'),
      ).toBe(true);
    });

    it('retorna false para URL genérica', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://example.com')).toBe(false);
    });

    it('retorna false para URL estranha', async () => {
      const { isKnownMarketplaceDomain } = await import('@omestre/shared');
      expect(isKnownMarketplaceDomain('https://some-random-site.com.br')).toBe(
        false,
      );
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // resolveUrl()
  // ══════════════════════════════════════════════════════════════════

  describe('resolveUrl()', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('retorna URL final após redirect', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(makeMockResponse(MARKETPLACE_URL)),
      ) as unknown as typeof fetch;
      const { resolveUrl } = await import('@omestre/shared');
      const result = await resolveUrl(SHORTENER_URL);
      expect(result).toBe(MARKETPLACE_URL);
    });

    it('retorna URL original quando fetch falha', async () => {
      globalThis.fetch = mock(() =>
        Promise.reject(new Error('Network failure')),
      ) as unknown as typeof fetch;
      const { resolveUrl } = await import('@omestre/shared');
      const result = await resolveUrl(SHORTENER_URL);
      expect(result).toBe(SHORTENER_URL);
    });

    it('retorna URL original quando response.url é vazia', async () => {
      const resp = makeMockResponse('');
      (resp as any).url = '';
      globalThis.fetch = mock(() => Promise.resolve(resp)) as unknown as typeof fetch;
      const { resolveUrl } = await import('@omestre/shared');
      const result = await resolveUrl(SHORTENER_URL);
      expect(result).toBe(SHORTENER_URL);
    });

    it('envia User-Agent de navegador na requisição', async () => {
      let capturedHeaders: Record<string, string> = {};
      globalThis.fetch = mock((_url: string, opts: any) => {
        capturedHeaders = opts.headers || {};
        return Promise.resolve(makeMockResponse(MARKETPLACE_URL));
      }) as unknown as typeof fetch;
      const { resolveUrl } = await import('@omestre/shared');
      await resolveUrl(SHORTENER_URL);
      expect(capturedHeaders['User-Agent']).toContain('Mozilla');
    });

    it('não redireciona quando URL já é final', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(makeMockResponse(MARKETPLACE_URL)),
      ) as unknown as typeof fetch;
      const { resolveUrl } = await import('@omestre/shared');
      const result = await resolveUrl(MARKETPLACE_URL);
      expect(result).toBe(MARKETPLACE_URL);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // isMessageValidOffer()
  // ══════════════════════════════════════════════════════════════════

  describe('isMessageValidOffer()', () => {
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
      globalThis.fetch = mock(() =>
        Promise.resolve(makeMockResponse(GENERIC_URL)),
      ) as unknown as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('retorna false para texto vazio', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('')).toBe(false);
    });

    it('retorna true para URL direta da Shopee', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('Oferta https://shopee.com.br/produto')).toBe(true);
    });

    it('retorna true para URL direta do Mercado Livre', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(
        await isMessageValidOffer('https://mercadolivre.com.br/item/123'),
      ).toBe(true);
    });

    it('retorna true para URL direta da Amazon', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('https://amazon.com.br/dp/ABC')).toBe(true);
    });

    it('retorna true para URL direta da Magalu', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('https://magalu.com.br/produto')).toBe(true);
    });

    it('retorna true para maga.lu (encurtador Magalu sem redirect)', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('https://maga.lu/xyz')).toBe(true);
    });

    it('retorna false para texto sem URLs', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('Bom dia pessoal!')).toBe(false);
    });

    it('segue redirect de encurtador e retorna true quando resolve para marketplace', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(
          makeMockResponse('https://shopee.com.br/product/redirect'),
        ),
      ) as unknown as typeof fetch;
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('Compre https://shp.ee/abc123')).toBe(true);
    });

    it('retorna false quando encurtador não resolve para marketplace', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(makeMockResponse('https://example.com/other')),
      ) as unknown as typeof fetch;
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('Link: https://bit.ly/abc')).toBe(false);
    });

    it('retorna false quando resolveUrl falha no encurtador', async () => {
      globalThis.fetch = mock(() => Promise.reject(new Error('Timeout'))) as unknown as typeof fetch;
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('Link https://bit.ly/abc')).toBe(false);
    });

    it('passo 3: tenta resolver URL desconhecida que redireciona para marketplace', async () => {
      globalThis.fetch = mock((fetchedUrl: string) => {
        if (fetchedUrl.includes('example.com')) {
          return Promise.resolve(
            makeMockResponse('https://shopee.com.br/redirected'),
          );
        }
        return Promise.resolve(makeMockResponse(fetchedUrl));
      }) as unknown as typeof fetch;
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('Veja https://example.com/produto')).toBe(true);
    });

    it('passo 3: retorna false quando URL desconhecida não redireciona para marketplace', async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve(makeMockResponse(GENERIC_URL)),
      ) as unknown as typeof fetch;
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('Veja https://example.com/page')).toBe(false);
    });

    it('passo 3: não tenta resolver URL sem http (continue)', async () => {
      const fetchSpy = mock(() =>
        Promise.resolve(makeMockResponse('https://shopee.com.br/redirect')),
      ) as unknown as typeof fetch;
      globalThis.fetch = fetchSpy;
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(await isMessageValidOffer('www.shopee.com.br')).toBe(false);
    });

    it('prioriza detectMarketplace sem precisar de redirect', async () => {
      const fetchSpy = mock(() =>
        Promise.resolve(makeMockResponse('')),
      ) as unknown as typeof fetch;
      globalThis.fetch = fetchSpy;
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(
        await isMessageValidOffer('Compre https://shopee.com.br/link'),
      ).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('processa múltiplas URLs na mensagem (primeira marketplace = true)', async () => {
      const { isMessageValidOffer } = await import('@omestre/shared');
      expect(
        await isMessageValidOffer(
          'https://shopee.com.br/a e https://example.com/b',
        ),
      ).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // validateGroup()
  // ══════════════════════════════════════════════════════════════════

  describe('validateGroup()', () => {
    const INSTANCE = 'user-1';
    const JID = '120363000000000001@g.us';
    const NAME = 'Grupo Promoções';

    it('passed=true quando 100% das mensagens são ofertas', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({
          success: true,
          messages: [
            { text: 'Oferta https://shopee.com.br/a' },
            { text: 'Promo https://shopee.com.br/b' },
          ],
        }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.passed).toBe(true);
      expect(result.ratio).toBe(1);
      expect(result.validOffers).toBe(2);
      expect(result.totalMessages).toBe(2);
      expect(result.invalidMessages).toBe(0);
    });

    it('passed=true quando ratio >= 0.7 (exato)', async () => {
      const messages = [
        ...Array.from({ length: 7 }, (_, i) => ({
          text: `Oferta https://shopee.com.br/produto${i}`,
        })),
        ...Array.from({ length: 3 }, () => ({
          text: 'Bom dia grupo!',
        })),
      ];
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: true, messages }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.passed).toBe(true);
      expect(result.ratio).toBe(0.7);
      expect(result.validOffers).toBe(7);
      expect(result.invalidMessages).toBe(3);
    });

    it('passed=false quando ratio < 0.7', async () => {
      const messages = [
        ...Array.from({ length: 3 }, (_, i) => ({
          text: `Oferta https://shopee.com.br/produto${i}`,
        })),
        ...Array.from({ length: 7 }, () => ({
          text: 'Só conversa aqui',
        })),
      ];
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: true, messages }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.passed).toBe(false);
      expect(result.ratio).toBe(0.3);
    });

    it('passed=false com erro quando fetchGroupMessages falha', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: false, error: 'Erro de rede simulado' }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Erro de rede simulado');
      expect(result.totalMessages).toBe(0);
      expect(result.validOffers).toBe(0);
    });

    it('passed=false quando não há mensagens', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: true, messages: [] }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.passed).toBe(false);
      expect(result.errors).toContain('Nenhuma mensagem encontrada nos últimos registros do grupo');
      expect(result.totalMessages).toBe(0);
    });

    it('retorna erro padrão quando fetch falha sem mensagem de erro', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: false }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.passed).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('usa limit padrão de 30 mensagens', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: true, messages: [] }),
      );
      const { validateGroup } = await import('@omestre/shared');
      await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(mockFetchGroupMessages).toHaveBeenCalledWith(INSTANCE, JID, 30);
    });

    it('aceita limit customizado', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: true, messages: [] }),
      );
      const { validateGroup } = await import('@omestre/shared');
      await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages, 50);
      expect(mockFetchGroupMessages).toHaveBeenCalledWith(INSTANCE, JID, 50);
    });

    it('retorna metadados corretos do grupo', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({
          success: true,
          messages: [{ text: 'https://shopee.com.br/a' }],
        }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.groupJid).toBe(JID);
      expect(result.groupName).toBe(NAME);
    });

    it('trata mensagens com text undefined como texto vazio', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({
          success: true,
          messages: [
            { text: undefined },
            { text: '' },
          ],
        }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.passed).toBe(false);
      expect(result.ratio).toBe(0);
    });

    it('lida com erro em uma das mensagens sem quebrar o batch', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({
          success: true,
          messages: [
            { text: 'Oferta https://shopee.com.br/a' },
            { text: 'URL estranha' },
          ],
        }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages);
      expect(result.validOffers).toBe(1);
      expect(result.totalMessages).toBe(2);
    });

    it('arredonda ratio para 2 casas decimais', async () => {
      const messages = [
        ...Array.from({ length: 6 }, (_, i) => ({
          text: `Oferta https://shopee.com.br/produto${i}`,
        })),
        ...Array.from({ length: 22 }, () => ({
          text: 'Apenas conversa',
        })),
      ];
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({ success: true, messages }),
      );
      const { validateGroup } = await import('@omestre/shared');
      const result = await validateGroup(INSTANCE, JID, NAME, mockFetchGroupMessages, 28);
      expect(result.ratio).toBe(0.21);
      expect(result.passed).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // validateOfferGroups()
  // ══════════════════════════════════════════════════════════════════

  describe('validateOfferGroups()', () => {
    const INSTANCE = 'user-1';
    const GROUP_A = { jid: 'a@g.us', name: 'Grupo A' };
    const GROUP_B = { jid: 'b@g.us', name: 'Grupo B' };

    it('overallPassed=true quando todos os grupos passam', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({
          success: true,
          messages: [{ text: 'https://shopee.com.br/a' }],
        }),
      );
      const { validateOfferGroups } = await import('@omestre/shared');
      const result = await validateOfferGroups(INSTANCE, [GROUP_A, GROUP_B], mockFetchGroupMessages);
      expect(result.overallPassed).toBe(true);
      expect(result.groups).toHaveLength(2);
      expect(result.groups[0]!.passed).toBe(true);
      expect(result.groups[1]!.passed).toBe(true);
    });

    it('overallPassed=false quando um grupo falha', async () => {
      let callCount = 0;
      mockFetchGroupMessages.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            success: true,
            messages: [{ text: 'https://shopee.com.br/a' }],
          });
        }
        return Promise.resolve({
          success: true,
          messages: [{ text: 'Bom dia' }, { text: 'Tudo bem?' }],
        });
      });
      const { validateOfferGroups } = await import('@omestre/shared');
      const result = await validateOfferGroups(INSTANCE, [GROUP_A, GROUP_B], mockFetchGroupMessages);
      expect(result.overallPassed).toBe(false);
      expect(result.groups[0]!.passed).toBe(true);
      expect(result.groups[1]!.passed).toBe(false);
    });

    it('overallPassed=false quando não há grupos', async () => {
      const { validateOfferGroups } = await import('@omestre/shared');
      const result = await validateOfferGroups(INSTANCE, [], mockFetchGroupMessages);
      expect(result.overallPassed).toBe(false);
      expect(result.groups).toHaveLength(0);
      expect(result.totalMessages).toBe(0);
    });

    it('calcula totais consolidados entre grupos', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({
          success: true,
          messages: [
            { text: 'https://shopee.com.br/a' },
            { text: 'https://shopee.com.br/b' },
          ],
        }),
      );
      const { validateOfferGroups } = await import('@omestre/shared');
      const result = await validateOfferGroups(INSTANCE, [GROUP_A, GROUP_B], mockFetchGroupMessages);
      expect(result.totalMessages).toBe(4);
      expect(result.totalValidOffers).toBe(4);
      expect(result.overallRatio).toBe(1);
    });

    it('calcula overallRatio como média ponderada', async () => {
      let callIdx = 0;
      mockFetchGroupMessages.mockImplementation(() => {
        callIdx++;
        if (callIdx === 1) {
          return Promise.resolve({
            success: true,
            messages: [
              { text: 'https://shopee.com.br/a' },
              { text: 'https://shopee.com.br/b' },
            ],
          });
        }
        return Promise.resolve({
          success: true,
          messages: [
            { text: 'https://shopee.com.br/c' },
            { text: 'Bom dia!' },
          ],
        });
      });
      const { validateOfferGroups } = await import('@omestre/shared');
      const result = await validateOfferGroups(INSTANCE, [GROUP_A, GROUP_B], mockFetchGroupMessages);
      expect(result.totalMessages).toBe(4);
      expect(result.totalValidOffers).toBe(3);
      expect(result.overallRatio).toBe(0.75);
    });

    it('overallRatio arredondado para 2 casas', async () => {
      mockFetchGroupMessages.mockImplementation(() =>
        Promise.resolve({
          success: true,
          messages: [
            { text: 'https://shopee.com.br/a' },
            { text: 'Bom dia' },
            { text: 'Tudo bem?' },
          ],
        }),
      );
      const { validateOfferGroups } = await import('@omestre/shared');
      const result = await validateOfferGroups(INSTANCE, [GROUP_A, GROUP_B], mockFetchGroupMessages);
      expect(result.overallRatio).toBe(0.33);
    });

    it('inclui resultados individuais de cada grupo', async () => {
      mockFetchGroupMessages.mockImplementation((_inst, jid) => {
        if (jid === 'a@g.us') {
          return Promise.resolve({
            success: true,
            messages: [
              { text: 'https://shopee.com.br/a' },
              { text: 'https://shopee.com.br/b' },
            ],
          });
        }
        return Promise.resolve({
          success: true,
          messages: [{ text: 'Bom dia' }],
        });
      });
      const { validateOfferGroups } = await import('@omestre/shared');
      const result = await validateOfferGroups(INSTANCE, [GROUP_A, GROUP_B], mockFetchGroupMessages);
      expect(result.groups[0]!.groupJid).toBe('a@g.us');
      expect(result.groups[0]!.validOffers).toBe(2);
      expect(result.groups[1]!.groupJid).toBe('b@g.us');
      expect(result.groups[1]!.validOffers).toBe(0);
    });
  });
});
