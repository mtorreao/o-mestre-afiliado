/**
 * Testes unitários — verifyAffiliateLink
 *
 * Valida que a função confere corretamente os parâmetros de afiliado
 * (meliid, melitat, matt_word, tag) contra os dados do afiliado dono
 * do grupo destino, bloqueando quando não batem.
 *
 * Fluxo esperado (ver mirror-pipeline.ts → step 4c):
 *   1. Converte o link
 *   2. verifyAffiliateLink() inspeciona params da URL convertida
 *   3. Confere contra o afiliado no banco
 *   4. Se não bater → bloqueia com valid=false + reason
 *   5. Se bater ou for confiável (meli.la, Shopee) → valid=true
 */

import { describe, it, expect, mock, beforeAll, afterAll, beforeEach } from 'bun:test';

// ─── Mocks ──────────────────────────────────────────────────────────────

// Mock do MlAffiliateRepository — usado por verifyMercadoLivreLink
const mockFindByPlatformUserId = mock();
const mockAffiliatesFindById = mock();
const baseDbMockExports = {
  MlAffiliateRepository: class FakeMlRepo {
    findByPlatformUserId = mockFindByPlatformUserId;
  },
  UserCredentialsRepository: class FakeCredRepo {
    findByUserId = mock();
  },
  getDb: () => dbMock,
  affiliates: {
    id: 'id',
    evolutionInstanceId: 'evolutionInstanceId',
  },
  // Outros exports usados por mirror-pipeline.ts que não importam para o teste
  reflectedOffers: { id: 'id', affiliateId: 'affiliateId', originalLink: 'originalLink', reflectedAt: 'reflectedAt' },
  AffiliatesRepository: class FakeAffRepo {
    findById = mockAffiliatesFindById;
  },
};

// Mock do drizzle query chain: db.select(...).from(...).where(...).limit(1)
function makeDbMock(evolutionInstanceId: string | null = 'user-42') {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve([
              evolutionInstanceId ? { evolutionInstanceId } : null,
            ].filter(Boolean)),
        }),
      }),
    }),
  };
}
let dbMock: ReturnType<typeof makeDbMock>;

// ─── Helpers ─────────────────────────────────────────────────────────────

beforeAll(() => {
  dbMock = makeDbMock('user-42');
  mock.module('@omestre/db', () => baseDbMockExports);
});

afterAll(() => {
  mock.restore();
});

function resetMocks() {
  mockFindByPlatformUserId.mockReset();
  dbMock = makeDbMock('user-42');
}

/**
 * Helper para configurar o ML affiliate retornado pelo repositório.
 */
function withMlAffiliate(overrides: Partial<{
  userId: number | null;
  mlUserId: string;
  nickname: string;
  meliid: string | null;
  melitat: string | null;
  sessionCookies: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  connectedAt: Date;
  lastUsedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  const defaults = {
    id: 1,
    userId: 42,
    mlUserId: 'ML123456',
    nickname: 'TEST_USER',
    meliid: 'MLB-1234567890',
    melitat: 'melitat-correto',
    sessionCookies: null,
    accessToken: 'fake-access-token',
    refreshToken: 'fake-refresh-token',
    expiresAt: new Date('2099-12-31'),
    connectedAt: new Date('2025-01-01'),
    lastUsedAt: new Date('2025-01-01'),
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
  };
  mockFindByPlatformUserId.mockResolvedValue({ ...defaults, ...overrides });
}

// ═════════════════════════════════════════════════════════════════════════
// MERCADO LIVRE
// ═════════════════════════════════════════════════════════════════════════

describe('verifyAffiliateLink — Mercado Livre', () => {
  beforeEach(() => {
    resetMocks();
  });

  // ─── meli.la short links ──────────────────────────────────────────

  it('aprova link curto meli.la sem params de afiliado (confiável por API)', async () => {
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');

    const result = await verifyAffiliateLink(
      'https://meli.la/p/MLB-1234567890',
      1,
      'mercadolivre',
    );
    expect(result).toEqual({ valid: true });
  });

  it('aprova link longo ML sem params de afiliado (pode ser meli.la resolvido)', async () => {
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');

    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/produto/MLB-1234567890',
      1,
      'mercadolivre',
    );
    expect(result).toEqual({ valid: true });
  });

  // ─── melitat ──────────────────────────────────────────────────────

  it('bloqueia quando melitat da URL não corresponde ao afiliado', async () => {
    withMlAffiliate({ melitat: 'melitat-correto' });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?melitat=melitat-errado',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('melitat');
    expect(result.reason).toContain('melitat-correto');
    expect(result.reason).toContain('melitat-errado');
  });

  it('aprova quando melitat da URL corresponde ao afiliado', async () => {
    withMlAffiliate({ melitat: 'melitat-correto' });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?melitat=melitat-correto',
      1,
      'mercadolivre',
    );
    expect(result).toEqual({ valid: true });
  });

  it('bloqueia quando melitat presente na URL mas afiliado não tem melitat configurado', async () => {
    withMlAffiliate({ melitat: null });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?melitat=algum-valor',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('melitat presente na URL');
    expect(result.reason).toContain('não possui melitat configurado');
  });

  // ─── matt_word ────────────────────────────────────────────────────

  it('bloqueia quando matt_word da URL não corresponde ao melitat do afiliado', async () => {
    withMlAffiliate({ melitat: 'melitat-correto' });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?matt_word=melitat-errado',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('matt_word');
    expect(result.reason).toContain('melitat-correto');
    expect(result.reason).toContain('melitat-errado');
  });

  it('aprova quando matt_word da URL corresponde ao melitat do afiliado', async () => {
    withMlAffiliate({ melitat: 'melitat-correto' });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?matt_word=melitat-correto',
      1,
      'mercadolivre',
    );
    expect(result).toEqual({ valid: true });
  });

  it('bloqueia quando matt_word presente na URL mas afiliado sem melitat', async () => {
    withMlAffiliate({ melitat: null });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?matt_word=algum-valor',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('matt_word presente na URL');
    expect(result.reason).toContain('não possui melitat configurado');
  });

  // ─── meliid ───────────────────────────────────────────────────────

  it('bloqueia quando meliid da URL não corresponde ao afiliado', async () => {
    withMlAffiliate({ meliid: 'MLB-1234567890', melitat: 'melitat-correto' });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?meliid=MLB-0000000000&melitat=melitat-correto',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('meliid');
    expect(result.reason).toContain('MLB-1234567890');
    expect(result.reason).toContain('MLB-0000000000');
  });

  it('aprova quando meliid da URL corresponde ao afiliado', async () => {
    withMlAffiliate({ meliid: 'MLB-1234567890', melitat: 'melitat-correto' });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?meliid=MLB-1234567890&melitat=melitat-correto',
      1,
      'mercadolivre',
    );
    expect(result).toEqual({ valid: true });
  });

  it('ignora meliid ausente quando afiliado não tem meliid configurado', async () => {
    withMlAffiliate({ meliid: null, melitat: 'melitat-correto' });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?melitat=melitat-correto',
      1,
      'mercadolivre',
    );
    expect(result).toEqual({ valid: true });
  });

  // ─── Mixed params ─────────────────────────────────────────────────

  it('bloqueia quando melitat e meliid batem mas matt_word não', async () => {
    withMlAffiliate({
      meliid: 'MLB-1234567890',
      melitat: 'melitat-correto',
    });
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?meliid=MLB-1234567890&melitat=melitat-correto&matt_word=outro-valor',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('matt_word');
  });

  // ─── ML sem afiliado vinculado ─────────────────────────────────────

  it('bloqueia quando URL tem params ML mas usuário não tem ml_affiliate', async () => {
    mockFindByPlatformUserId.mockResolvedValue(null);
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?melitat=algum-valor',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('parâmetros ML');
    expect(result.reason).toContain('afiliado não vinculado');
  });

  // ─── Afiliado sem evolutionInstanceId ──────────────────────────────

  it('bloqueia quando afiliado não tem evolutionInstanceId', async () => {
    dbMock = makeDbMock(null);
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://www.mercadolivre.com.br/p?melitat=algum-valor',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('sem evolutionInstanceId');
  });

  // ─── URL inválida ─────────────────────────────────────────────────

  it('bloqueia quando URL convertida é inválida', async () => {
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'not-a-valid-url',
      1,
      'mercadolivre',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('URL convertida inválida');
  });

  // ─── convertedUrl null ────────────────────────────────────────────

  it('passa quando convertedUrl é null (validação delegada ao passo 4b)', async () => {
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(null, 1, 'mercadolivre');
    expect(result).toEqual({ valid: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// AMAZON
// ═════════════════════════════════════════════════════════════════════════

describe('verifyAffiliateLink — Amazon', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('aprova URL Amazon sem tag (amzn.to link curto)', async () => {
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://amzn.to/3ABC123',
      1,
      'amazon',
    );
    expect(result).toEqual({ valid: true });
  });

  it('aprova quando tag corresponde ao tracking ID do afiliado', async () => {
    const mockFindByUserId = mock().mockResolvedValue({
      userId: 42,
      amazonTrackingId: 'tracking-correto-20',
      shopeeAppId: null,
      shopeeAppSecret: null,
      updatedAt: new Date(),
    });

    // Re-mock the UserCredentialsRepository for this specific test
    mock.module('@omestre/db', () => ({
      MlAffiliateRepository: class FakeMlRepo {
        findByPlatformUserId = mockFindByPlatformUserId;
      },
      UserCredentialsRepository: class FakeCredRepo {
        findByUserId = mockFindByUserId;
      },
      getDb: () => dbMock,
      affiliates: {
        id: 'id',
        evolutionInstanceId: 'evolutionInstanceId',
      },
    }));

    const { verifyAffiliateLink: val } = await import('../mirror-pipeline.ts');
    const result = await val(
      'https://www.amazon.com.br/dp/B0ABC123DEF?tag=tracking-correto-20',
      1,
      'amazon',
    );
    expect(result).toEqual({ valid: true });
  });

  it('bloqueia quando tag não corresponde ao tracking ID', async () => {
    const mockFindByUserId = mock().mockResolvedValue({
      userId: 42,
      amazonTrackingId: 'meu-tracking-20',
      shopeeAppId: null,
      shopeeAppSecret: null,
      updatedAt: new Date(),
    });

    mock.module('@omestre/db', () => ({
      MlAffiliateRepository: class FakeMlRepo {
        findByPlatformUserId = mockFindByPlatformUserId;
      },
      UserCredentialsRepository: class FakeCredRepo {
        findByUserId = mockFindByUserId;
      },
      getDb: () => dbMock,
      affiliates: {
        id: 'id',
        evolutionInstanceId: 'evolutionInstanceId',
      },
    }));

    const { verifyAffiliateLink: val } = await import('../mirror-pipeline.ts');
    const result = await val(
      'https://www.amazon.com.br/dp/B0ABC123DEF?tag=tracking-outro-20',
      1,
      'amazon',
    );
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Amazon tag');
    expect(result.reason).toContain('meu-tracking-20');
    expect(result.reason).toContain('tracking-outro-20');
  });
});

// ═════════════════════════════════════════════════════════════════════════
// SHOPEE
// ═════════════════════════════════════════════════════════════════════════

describe('verifyAffiliateLink — Shopee', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('aprova qualquer link Shopee (API oficial — confiável)', async () => {
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://shopee.com.br/product/12345',
      1,
      'shopee',
    );
    expect(result).toEqual({ valid: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// UNKNOWN MARKETPLACE
// ═════════════════════════════════════════════════════════════════════════

describe('verifyAffiliateLink — unknown marketplace', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('aprova marketplaces desconhecidos (sem verificação implementada)', async () => {
    const { verifyAffiliateLink } = await import('../mirror-pipeline.ts');
    const result = await verifyAffiliateLink(
      'https://example.com/product',
      1,
      'unknown',
    );
    expect(result).toEqual({ valid: true });
  });
});
