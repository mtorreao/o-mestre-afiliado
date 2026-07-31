/**
 * Testes de orquestração de `verifyAffiliateLink` (camada com I/O).
 *
 * Mocka o módulo `@omestre/db` (getDb + repositórios) para exercitar a
 * função assíncrona sem conectar ao PostgreSQL. A lógica de decisão em si
 * (comparação de parâmetros) já está coberta em `link-verifier-pure.test.ts`.
 *
 * Aqui validamos o encaminhamento:marketplace → repositório correto,
 * extração de userId via evolutionInstanceId, e tratamento de ausência
 * de vínculo / instância.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

// ─── Mock do @omestre/db ANTES de importar link-verifier.ts ───────────

const dbSelectResult: Array<{ evolutionInstanceId: string | null }> = [];
let mlAffiliateById: any = null;
let amazonAffiliateById: any = null;
let magaluAffiliateById: any = null;

const fakeSelectChain = () => ({
  from: () => ({
    where: () => ({
      limit: async () => dbSelectResult,
    }),
  }),
});

const MlAffiliateRepositoryMock = mock().mockImplementation(
  () =>
    ({
      findByPlatformUserId: async () => mlAffiliateById,
    }) as any,
);

const AmazonAffiliateRepositoryMock = mock().mockImplementation(
  () =>
    ({
      findByUserId: async () => amazonAffiliateById,
    }) as any,
);

const MagaluAffiliateRepositoryMock = mock().mockImplementation(
  () =>
    ({
      findByUserId: async () => magaluAffiliateById,
    }) as any,
);

// Flag para forçar erro de DB (exercita o catch de fail-open do verifyAffiliateLink)
let forceDbError = false;

const getDbMock = () => {
  if (forceDbError) throw new Error('DB indisponível');
  return { select: () => fakeSelectChain() };
};

await mock.module('@omestre/db', () => ({
  getDb: getDbMock,
  affiliates: { evolutionInstanceId: 'evolutionInstanceId' },
  MlAffiliateRepository: MlAffiliateRepositoryMock,
  AmazonAffiliateRepository: AmazonAffiliateRepositoryMock,
  MagaluAffiliateRepository: MagaluAffiliateRepositoryMock,
}));

const { verifyAffiliateLink } = await import('../link-verifier.ts');

// ─── Helpers ──────────────────────────────────────────────────────────

function setInstance(userId: number | null) {
  dbSelectResult.length = 0;
  dbSelectResult.push({
    evolutionInstanceId: userId === null ? null : `user-${userId}`,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('verifyAffiliateLink — orquestração (DB mockado)', () => {
  beforeEach(() => {
    mlAffiliateById = null;
    amazonAffiliateById = null;
    magaluAffiliateById = null;
    dbSelectResult.length = 0;
  });

  it('retorna válido quando convertedUrl é null', async () => {
    const r = await verifyAffiliateLink(null, 1, 'mercadolivre');
    expect(r).toEqual({ valid: true });
  });

  it('sempre válido para Shopee (não verifica parâmetros)', async () => {
    const r = await verifyAffiliateLink('https://shopee.com.br/produto?utm_x=1', 1, 'shopee');
    expect(r.valid).toBe(true);
  });

  it('ML: URL sem parâmetros ML é válida mesmo sem afiliado vinculado', async () => {
    setInstance(7);
    const r = await verifyAffiliateLink(
      'https://produto.mercadolivre.com.br/MLB-123',
      1,
      'mercadolivre',
    );
    expect(r.valid).toBe(true);
  });

  it('ML: afiliado não vinculado → inválido quando URL tem parâmetros', async () => {
    setInstance(7);
    mlAffiliateById = null;
    const r = await verifyAffiliateLink(
      'https://produto.mercadolivre.com.br/MLB-123?melitat=mtag',
      1,
      'mercadolivre',
    );
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('afiliado não vinculado');
  });

  it('ML: parâmetros conferem → válido', async () => {
    setInstance(7);
    mlAffiliateById = { meliid: 'abc', melitat: 'mtag' };
    const r = await verifyAffiliateLink(
      'https://produto.mercadolivre.com.br/MLB-123?melitat=mtag&matt_word=mtag',
      1,
      'mercadolivre',
    );
    expect(r.valid).toBe(true);
  });

  it('ML: parâmetros divergem → inválido', async () => {
    setInstance(7);
    mlAffiliateById = { meliid: 'abc', melitat: 'mtag' };
    const r = await verifyAffiliateLink(
      'https://produto.mercadolivre.com.br/MLB-123?melitat=OUTRO',
      1,
      'mercadolivre',
    );
    expect(r.valid).toBe(false);
  });

  it('ML: evolutionInstanceId nulo → inválido (sem instance)', async () => {
    setInstance(null);
    const r = await verifyAffiliateLink(
      'https://produto.mercadolivre.com.br/MLB-123?melitat=mtag',
      1,
      'mercadolivre',
    );
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('evolutionInstanceId');
  });

  it('Amazon: tag confere com tracking ID ativo → válido', async () => {
    setInstance(9);
    amazonAffiliateById = {
      trackingIds: [
        { tag: 'meusite-20', region: 'BR', active: true, isDefault: true, createdAt: '' },
      ],
    };
    const r = await verifyAffiliateLink('https://amzn.to/x?tag=meusite-20', 1, 'amazon');
    expect(r.valid).toBe(true);
  });

  it('Amazon: tag não confere → inválido', async () => {
    setInstance(9);
    amazonAffiliateById = {
      trackingIds: [
        { tag: 'meusite-20', region: 'BR', active: true, isDefault: true, createdAt: '' },
      ],
    };
    const r = await verifyAffiliateLink('https://amzn.to/x?tag=outra-20', 1, 'amazon');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('Amazon tag não corresponde');
  });

  it('Amazon: sem tracking IDs cadastrados → fail-open válido', async () => {
    setInstance(9);
    amazonAffiliateById = { trackingIds: [] };
    const r = await verifyAffiliateLink('https://amzn.to/x?tag=qualquer-20', 1, 'amazon');
    expect(r.valid).toBe(true);
  });

  it('URL ML malformada → inválido (catch de parse)', async () => {
    setInstance(7);
    mlAffiliateById = { meliid: 'abc', melitat: 'mtag' };
    const r = await verifyAffiliateLink('url-sem-protocolo', 1, 'mercadolivre');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('URL convertida inválida');
  });

  it('URL Amazon malformada → inválido (catch de parse)', async () => {
    setInstance(9);
    amazonAffiliateById = { trackingIds: [] };
    const r = await verifyAffiliateLink('url-sem-protocolo', 1, 'amazon');
    expect(r.valid).toBe(false);
    expect(r.reason).toContain('URL convertida inválida');
  });

  it('erro inesperado de DB → fail-open (válido por segurança)', async () => {
    forceDbError = true;
    try {
      const r = await verifyAffiliateLink(
        'https://produto.mercadolivre.com.br/MLB-123?melitat=mtag',
        1,
        'mercadolivre',
      );
      expect(r.valid).toBe(true);
    } finally {
      forceDbError = false;
    }
  });
});

// ─── Magalu ──────────────────────────────────────────────────────────

it('Magalu: slug confere com o afiliado → válido', async () => {
  setInstance(11);
  magaluAffiliateById = { storeSlug: 'magazinetorre', active: true };
  const r = await verifyAffiliateLink(
    'https://www.magazinevoce.com.br/magazinetorre/eliptico/p/eadk91754h/',
    1,
    'magalu',
  );
  expect(r.valid).toBe(true);
});

it('Magalu: slug diverge do afiliado → inválido', async () => {
  setInstance(11);
  magaluAffiliateById = { storeSlug: 'magazinetorre', active: true };
  const r = await verifyAffiliateLink(
    'https://www.magazinevoce.com.br/outraloja/eliptico/p/eadk91754h/',
    1,
    'magalu',
  );
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('Magalu store_slug não corresponde');
  expect(r.reason).toContain('esperado magazinetorre');
  expect(r.reason).toContain('recebido outraloja');
});

it('Magalu: URL sem slug de loja (magazineluiza.com.br) → válido (fail-open)', async () => {
  setInstance(11);
  magaluAffiliateById = { storeSlug: 'magazinetorre', active: true };
  const r = await verifyAffiliateLink(
    'https://www.magazineluiza.com.br/p/eadk91754h/',
    1,
    'magalu',
  );
  expect(r.valid).toBe(true);
});

it('Magalu: afiliado não vinculado → inválido', async () => {
  setInstance(11);
  magaluAffiliateById = null;
  const r = await verifyAffiliateLink(
    'https://www.magazinevoce.com.br/magazinetorre/eliptico/p/eadk91754h/',
    1,
    'magalu',
  );
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('afiliado não vinculado');
});

it('Magalu: evolutionInstanceId nulo → inválido (sem instance)', async () => {
  setInstance(null);
  const r = await verifyAffiliateLink(
    'https://www.magazinevoce.com.br/magazinetorre/eliptico/p/eadk91754h/',
    1,
    'magalu',
  );
  expect(r.valid).toBe(false);
  expect(r.reason).toContain('evolutionInstanceId');
});
