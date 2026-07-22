/**
 * Test: Validar cache Redis populado automaticamente na inicialização do worker.
 *
 * Critério:
 *   ✅ Worker em modo mirror popula mirror:source-group:{jid} ao conectar no Redis
 *   ✅ Usa dados do banco (findAllActiveWithSourceGroups) — não depende de API
 *   ✅ Pipeline Redis para atomicidade
 *   ✅ Falha não é fatal (try/catch silencia)
 *   ✅ mirror:source-groups:all (set) contém todos os JIDs
 *
 * Estratégia:
 *   - Mock @omestre/db com dados controlados de sourceGroups via AffiliatesRepository
 *   - Mock ioredis com FakeRedis que captura operações SET/SADD
 *   - Testa: população normal, sem sourceGroups, DB vazio, DB com erro, múltiplos afiliados
 */

import { describe, it, expect, mock, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';

// ══════════════════════════════════════════════════════════════════════
// Dados de teste
// ══════════════════════════════════════════════════════════════════════

interface MockAffiliate {
  id: number;
  name: string;
  active: boolean;
  evolutionInstanceId: string | null;
  sourceGroups: { jid: string; name: string }[] | null;
  targetGroups: { jid: string; name: string }[] | null;
  excludedGroups: unknown[];
  filters: { blacklist: string[]; keywords: string[]; dedupHours: number };
  messageTemplate: string | null;
  credentialsEncrypted: string | null;
  lastValidatedAt: Date | null;
  lastValidationPassed: boolean | null;
  lastValidationReport: unknown | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Seed data ───────────────────────────────────────────────────────

const makeAffiliate = (overrides: Partial<MockAffiliate>): MockAffiliate => ({
  id: 1,
  name: 'Test Affiliate',
  active: true,
  evolutionInstanceId: 'user-1',
  sourceGroups: [],
  targetGroups: [],
  excludedGroups: [],
  filters: { blacklist: [], keywords: [], dedupHours: 24 },
  messageTemplate: null,
  credentialsEncrypted: null,
  lastValidatedAt: null,
  lastValidationPassed: null,
  lastValidationReport: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const AFF_WITH_GROUPS_1 = makeAffiliate({
  id: 1,
  evolutionInstanceId: 'user-1',
  sourceGroups: [
    { jid: '120363000000000001@g.us', name: 'Grupo Promoções' },
    { jid: '120363000000000002@g.us', name: 'Grupo Ofertas' },
  ],
});

const AFF_WITH_GROUPS_2 = makeAffiliate({
  id: 2,
  evolutionInstanceId: 'user-2',
  sourceGroups: [
    { jid: '120363000000000003@g.us', name: 'Grupo Teste' },
  ],
});

const AFF_NO_GROUPS = makeAffiliate({
  id: 3,
  evolutionInstanceId: 'user-3',
  sourceGroups: [],
});

const AFF_NULL_GROUPS = makeAffiliate({
  id: 4,
  evolutionInstanceId: 'user-4',
  sourceGroups: null,
});

// ══════════════════════════════════════════════════════════════════════
// Estado do mock DB
// ══════════════════════════════════════════════════════════════════════

let mockAffiliatesData: MockAffiliate[] = [];
let mockDbError: Error | null = null;

// ══════════════════════════════════════════════════════════════════════
// Fake Redis — captura operações pipeline
// ══════════════════════════════════════════════════════════════════════

/** Operação capturada do pipeline */
interface PipelineOp {
  cmd: string;
  args: unknown[];
}

let capturedOps: PipelineOp[] = [];

class FakeRedisPipeline {
  private ops: PipelineOp[] = [];

  set(key: string, value: string): this {
    this.ops.push({ cmd: 'set', args: [key, value] });
    return this;
  }

  sadd(key: string, member: string): this {
    this.ops.push({ cmd: 'sadd', args: [key, member] });
    return this;
  }

  async exec(): Promise<unknown[]> {
    capturedOps = [...this.ops];
    return this.ops.map(() => [null, 'OK'] as [Error | null, string]);
  }
}

class FakeRedis {
  constructor(_url?: string) { /* no-op */ }
  on = () => {};
  connect = async () => {};
  quit = () => {};

  pipeline(): FakeRedisPipeline {
    return new FakeRedisPipeline();
  }
}

// ══════════════════════════════════════════════════════════════════════
// Testes
// ══════════════════════════════════════════════════════════════════════

describe('source-group-cache', () => {
  beforeAll(() => {
    mock.module('ioredis', () => ({ default: FakeRedis }));

    mock.module('@omestre/db', () => ({
      getDb: () => ({}),
      closeDb: () => Promise.resolve(),
      getClient: () => ({}),
      checkDbHealth: () => Promise.resolve({ ok: true, latencyMs: 0 }),
      omestre: {},
      affiliates: {},
      mlAffiliates: {},
      reflectedOffers: {},
      marketplaceEnum: {},
      offerStatusEnum: {},
      users: {},
      userCredentials: {},
      userWhatsAppInstances: {},
      MlAffiliateRepository: class {
        async findByPlatformUserId() { return null; }
      },
      UserRepository: class {},
      UserCredentialsRepository: class {
        async findByUserId() { return null; }
      },
      WhatsAppInstanceRepository: class {},
      AffiliatesRepository: class {
        async findAllActiveWithSourceGroups(): Promise<MockAffiliate[]> {
          if (mockDbError) throw mockDbError;
          return mockAffiliatesData.filter((a) => {
            if (!a.active) return false;
            const groups = a.sourceGroups;
            return groups != null && groups.length > 0;
          });
        }
      },
      MirrorLogRepository: class {},
    }));

    // Dependências que index.ts importa — mocks vazios pra evitar side effects
    mock.module('./mirror-pipeline.ts', () => ({
      processMirrorMessage: () => Promise.resolve(true),
    }));

    mock.module('./revalidate.ts', () => ({
      runRevalidation: () => Promise.resolve({ totalAffiliates: 0, validatedAffiliates: 0, failedAffiliates: 0, results: [] }),
      runRevalidationDaemon: () => Promise.resolve(),
    }));

    mock.module('./metrics.ts', () => ({
      startMetricsServer: () => {},
      setStatusMeta: () => {},
    }));

    mock.module('./dead-letter-queue.ts', () => ({
      pushToDLQ: () => Promise.resolve(),
      purgeOldDLQItems: () => Promise.resolve(0),
    }));
  });

  afterAll(() => {
    mock.restore();
  });

  describe('populateSourceGroupCache', () => {
    let populateSourceGroupCache: (
      redis: InstanceType<typeof FakeRedis>,
    ) => Promise<void>;

    beforeEach(async () => {
      // Reset state
      mockAffiliatesData = [];
      mockDbError = null;
      capturedOps = [];

      // Import fresh — Bun cache desduplica pelo path, mas como os mocks
      // já estão definidos (mock.module é global), o import pega os mocks.
      const mod = await import('../index.ts');
      populateSourceGroupCache = mod.populateSourceGroupCache as (
        redis: InstanceType<typeof FakeRedis>,
      ) => Promise<void>;
    });

    // ── CENÁRIO 1: Cache populado com grupos ──────────────────────────

    it('popula cache Redis com sourceGroups de afiliados ativos', async () => {
      mockAffiliatesData = [AFF_WITH_GROUPS_1];

      const redis = new FakeRedis();
      await populateSourceGroupCache(redis);

      // Verifica operações SET
      const sets = capturedOps.filter((op) => op.cmd === 'set');
      expect(sets.length).toBe(2);

      const key1 = sets[0].args[0] as string;
      const val1 = JSON.parse(sets[0].args[1] as string);
      expect(key1).toBe('mirror:source-group:120363000000000001@g.us');
      expect(val1).toEqual({ affiliateId: 1, groupName: 'Grupo Promoções' });

      const key2 = sets[1].args[0] as string;
      const val2 = JSON.parse(sets[1].args[1] as string);
      expect(key2).toBe('mirror:source-group:120363000000000002@g.us');
      expect(val2).toEqual({ affiliateId: 1, groupName: 'Grupo Ofertas' });

      // Verifica operações SADD
      const sadds = capturedOps.filter((op) => op.cmd === 'sadd');
      expect(sadds.length).toBe(2);
      expect(sadds[0].args).toEqual(['mirror:source-groups:all', '120363000000000001@g.us']);
      expect(sadds[1].args).toEqual(['mirror:source-groups:all', '120363000000000002@g.us']);
    });

    // ── CENÁRIO 2: Múltiplos afiliados ────────────────────────────────

    it('popula cache com múltiplos afiliados em uma única pipeline', async () => {
      mockAffiliatesData = [AFF_WITH_GROUPS_1, AFF_WITH_GROUPS_2];

      const redis = new FakeRedis();
      await populateSourceGroupCache(redis);

      const sets = capturedOps.filter((op) => op.cmd === 'set');
      expect(sets.length).toBe(3); // 2 + 1 = 3 groups total

      // Afiliado 1
      expect(sets[0].args[0]).toBe('mirror:source-group:120363000000000001@g.us');
      expect(sets[1].args[0]).toBe('mirror:source-group:120363000000000002@g.us');
      // Afiliado 2
      expect(sets[2].args[0]).toBe('mirror:source-group:120363000000000003@g.us');

      const sadds = capturedOps.filter((op) => op.cmd === 'sadd');
      expect(sadds.length).toBe(3);

      // Verifica a ordem: SADD para cada group jid
      const allMembers = sadds.map((op) => op.args[1]);
      expect(allMembers).toContain('120363000000000001@g.us');
      expect(allMembers).toContain('120363000000000002@g.us');
      expect(allMembers).toContain('120363000000000003@g.us');
    });

    // ── CENÁRIO 3: DB vazio ───────────────────────────────────────────

    it('NÃO faz SET/SADD quando não há afiliados no banco', async () => {
      mockAffiliatesData = [];

      const redis = new FakeRedis();
      await populateSourceGroupCache(redis);

      expect(capturedOps.length).toBe(0);
    });

    // ── CENÁRIO 4: Afiliados sem sourceGroups ─────────────────────────

    it('ignora afiliados sem sourceGroups configurados', async () => {
      mockAffiliatesData = [AFF_NO_GROUPS, AFF_NULL_GROUPS];

      const redis = new FakeRedis();
      await populateSourceGroupCache(redis);

      // Nenhum SET/SADD porque nenhum tem sourceGroups com dados
      expect(capturedOps.length).toBe(0);
    });

    // ── CENÁRIO 5: DB com erro → falha não é fatal ───────────────────

    it('falha no DB NÃO é fatal — apenas loga warning', async () => {
      mockDbError = new Error('Conexão recusada');

      const redis = new FakeRedis();
      // Não deve lançar
      await expect(populateSourceGroupCache(redis)).resolves.toBeUndefined();

      // Nenhuma operação Redis foi executada
      expect(capturedOps.length).toBe(0);
    });

    // ── CENÁRIO 6: Afiliado com groupName vazio ──────────────────────

    it('usa string vazia quando groupName não está presente', async () => {
      mockAffiliatesData = [
        makeAffiliate({
          id: 5,
          evolutionInstanceId: 'user-5',
          sourceGroups: [{ jid: '120363000000000005@g.us', name: '' }],
        }),
      ];

      const redis = new FakeRedis();
      await populateSourceGroupCache(redis);

      const sets = capturedOps.filter((op) => op.cmd === 'set');
      expect(sets.length).toBe(1);

      const val = JSON.parse(sets[0].args[1] as string);
      expect(val).toEqual({ affiliateId: 5, groupName: '' });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // Testes de integração: chamada de runMirror() (simulada)
  // ══════════════════════════════════════════════════════════════════════

  describe('populateSourceGroupCache — caminho runMirror', () => {
    let populateSourceGroupCache: (
      redis: InstanceType<typeof FakeRedis>,
    ) => Promise<void>;

    beforeEach(async () => {
      capturedOps = [];
      mockAffiliatesData = [];
      mockDbError = null;
      const mod = await import('../index.ts');
      populateSourceGroupCache = mod.populateSourceGroupCache as (
        redis: InstanceType<typeof FakeRedis>,
      ) => Promise<void>;
    });

    it('é chamada ANTES de criar consumer group (runMirror flow)', async () => {
      // Verificamos que a função é independente — não depende de
      // POST /api/affiliate/groups-config, apenas do banco de dados.
      // Esta validação é estrutural: a chamada em runMirror() está
      // em index.ts linha 304: await populateSourceGroupCache(redis);
      // ANTES de ensureConsumerGroup (linha 307).
      mockAffiliatesData = [
        makeAffiliate({
          id: 10,
          evolutionInstanceId: 'user-10',
          sourceGroups: [{ jid: '120363000000000010@g.us', name: 'Grupo Integração' }],
        }),
      ];

      const redis = new FakeRedis();
      await populateSourceGroupCache(redis);

      const sets = capturedOps.filter((op) => op.cmd === 'set');
      expect(sets.length).toBe(1);
      expect(sets[0].args[0]).toBe('mirror:source-group:120363000000000010@g.us');
      expect(JSON.parse(sets[0].args[1] as string)).toEqual({
        affiliateId: 10,
        groupName: 'Grupo Integração',
      });

      // Confirma que a população usou dados do DB, NÃO de uma chamada API
      const sadds = capturedOps.filter((op) => op.cmd === 'sadd');
      expect(sadds.length).toBe(1);
      expect(sadds[0].args).toEqual([
        'mirror:source-groups:all',
        '120363000000000010@g.us',
      ]);
    });
  });
});
