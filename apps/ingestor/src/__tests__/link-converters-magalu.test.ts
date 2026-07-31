/**
 * Testes da orquestração de conversão Magalu (convertOfferUrl → ramo magalu).
 *
 * Mocka @omestre/db (MagaluAffiliateRepository), @omestre/converters,
 * @omestre/worker-common (processFailure), ./resolve-redirect.ts e
 * ./conversion-cache.ts para exercitar convertMagaluForAffiliate sem
 * rede/DB/Redis.
 *
 * A lógica de classificação (detectMarketplace, resolveEffectiveMarketplace,
 * extractUserIdFromInstanceName) roda REAL — é pura e já coberta em
 * link-converters-pure.test.ts.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ─── Estado dos mocks ────────────────────────────────────────────────

let magaluAffiliate: any = null;
let magaluConvertResult: any = null;
let magaluTouchCalls = 0;
let processFailureCalls: Array<{ instanceName: string; type: string }> = [];
let resolvedUrlOverride: string | null = null;

const MagaluAffiliateRepositoryMock = mock().mockImplementation(
  () =>
    ({
      findByUserId: async () => magaluAffiliate,
      touch: async () => {
        magaluTouchCalls += 1;
      },
    }) as any,
);

const processFailureMock = mock(async (instanceName: string, type: string) => {
  processFailureCalls.push({ instanceName, type });
});

let convertMagaluCalls = 0;
const convertMagaluUrlWithStoreSlugMock = mock(
  async (_url: string, _storeSlug: string | null | undefined) => {
    convertMagaluCalls += 1;
    return magaluConvertResult;
  },
);

const resolveRedirectUrlMock = mock(async (url: string) => resolvedUrlOverride ?? url);

// ─── Mocks de módulos ANTES de importar link-converters.ts ────────────

await mock.module('@omestre/db', () => ({
  UserCredentialsRepository: class {
    async findByUserId() {
      return null;
    }
  },
  MlAffiliateRepository: class {
    async findByPlatformUserId() {
      return null;
    }
  },
  AmazonAffiliateRepository: class {
    async findByUserId() {
      return null;
    }
  },
  MagaluAffiliateRepository: MagaluAffiliateRepositoryMock,
}));

await mock.module('@omestre/worker-common', () => ({
  processFailure: processFailureMock,
}));

await mock.module('@omestre/converters', () => ({
  convertMagaluUrlWithStoreSlug: convertMagaluUrlWithStoreSlugMock,
  convertShopeeUrlWithCredentials: async () => ({ success: false, affiliateUrl: null }),
  convertAmazonUrlWithAffiliate: async () => ({ success: false, affiliateUrl: null }),
  generateShortAffiliateLink: async () => ({ success: false, shortUrl: null }),
  convertUrl: async () => ({ success: false, affiliateUrl: null }),
}));

await mock.module('./resolve-redirect.ts', () => ({
  resolveRedirectUrl: resolveRedirectUrlMock,
  resolveMeliRedirect: async () => ({ url: '', isProduct: false }),
  isMeliProductUrl: () => false,
}));

await mock.module('./conversion-cache.ts', () => ({
  getCachedConversion: async () => null,
}));

const { convertOfferUrl } = await import('../link-converters.ts');

// ─── Tests ─────────────────────────────────────────────────────────────

const MAGALU_URL = 'https://www.magazineluiza.com.br/celular/p/abc123/';
const CONVERTED_URL = 'https://www.magazinevoce.com.br/magazinetorre/celular/p/abc123/';

describe('convertOfferUrl — Magalu', () => {
  beforeEach(() => {
    magaluAffiliate = null;
    magaluConvertResult = null;
    magaluTouchCalls = 0;
    convertMagaluCalls = 0;
    processFailureCalls = [];
    resolvedUrlOverride = null;
  });

  it('converte com o slug do afiliado e faz touch em sucesso', async () => {
    magaluAffiliate = { userId: 5, storeSlug: 'magazinetorre', active: true };
    magaluConvertResult = { success: true, affiliateUrl: CONVERTED_URL };

    const r = await convertOfferUrl(MAGALU_URL, 1, 'user-5');

    expect(r.success).toBe(true);
    expect(r.marketplace).toBe('magalu');
    expect(r.convertedUrl).toBe(CONVERTED_URL);
    expect(convertMagaluUrlWithStoreSlugMock).toHaveBeenCalledWith(MAGALU_URL, 'magazinetorre');
    expect(magaluTouchCalls).toBe(1);
    expect(processFailureCalls).toEqual([]);
  });

  it('bloqueia sem afiliado vinculado e notifica magalu_account_not_linked', async () => {
    magaluAffiliate = null;

    const r = await convertOfferUrl(MAGALU_URL, 1, 'user-5');

    expect(r.success).toBe(false);
    expect(r.convertedUrl).toBeNull();
    expect(r.error).toContain('Afiliado Magalu sem slug configurado');
    expect(r.error).toContain('Configurações → Magalu');
    expect(processFailureCalls).toEqual([
      { instanceName: 'user-5', type: 'magalu_account_not_linked' },
    ]);
    expect(magaluTouchCalls).toBe(0);
    expect(convertMagaluCalls).toBe(0);
  });

  it('bloqueia quando o afiliado está inativo', async () => {
    magaluAffiliate = { userId: 5, storeSlug: 'magazinetorre', active: false };

    const r = await convertOfferUrl(MAGALU_URL, 1, 'user-5');

    expect(r.success).toBe(false);
    expect(r.error).toContain('sem slug configurado');
    expect(processFailureCalls.length).toBe(1);
  });

  it('bloqueia quando o afiliado não tem storeSlug', async () => {
    magaluAffiliate = { userId: 5, storeSlug: null, active: true };

    const r = await convertOfferUrl(MAGALU_URL, 1, 'user-5');

    expect(r.success).toBe(false);
    expect(r.error).toContain('sem slug configurado');
    expect(processFailureCalls.length).toBe(1);
  });

  it('não faz touch quando a conversão falha', async () => {
    magaluAffiliate = { userId: 5, storeSlug: 'magazinetorre', active: true };
    magaluConvertResult = { success: false, affiliateUrl: null, error: 'Falha na conversão' };

    const r = await convertOfferUrl(MAGALU_URL, 1, 'user-5');

    expect(r.success).toBe(false);
    expect(r.convertedUrl).toBeNull();
    expect(r.error).toBe('Falha na conversão');
    expect(magaluTouchCalls).toBe(0);
  });

  it('usa o marketplace resolvido quando o redirector aponta para magalu', async () => {
    resolvedUrlOverride = 'https://www.magazinevoce.com.br/magazinetorre/celular/p/abc123/';
    magaluAffiliate = { userId: 5, storeSlug: 'magazinetorre', active: true };
    magaluConvertResult = { success: true, affiliateUrl: CONVERTED_URL };

    const r = await convertOfferUrl('https://go.promozone.ai/magalu/xyz', 1, 'user-5');

    expect(r.success).toBe(true);
    expect(r.marketplace).toBe('magalu');
  });
});
