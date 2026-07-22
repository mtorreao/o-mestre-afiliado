/**
 * Test: Validar TTL e renovação automática do cache Redis (group-cache.ts)
 *
 * Critérios:
 *   ✅ Escrita usa SETEX com TTL=3600 (1h)
 *   ✅ Leitura renova TTL automaticamente via EXPIRE
 *   ✅ Chaves expiram após 1h se não acessadas (não-expire !== renew)
 *   ✅ replaceSourceGroups usa SETEX no pipeline para novos grupos
 *   ✅ cacheSourceGroup também mantém o set mirror:source-groups:all (SADD)
 *   ✅ Redis indisponível retorna null sem lançar erro
 *
 * Estratégia:
 *   - Mock ./redis.ts para retornar FakeRedis que captura chamadas
 *   - Testa todas as funções exportadas de group-cache.ts
 *   - Verifica TTL=3600 em todas as operações de escrita
 *   - Verifica expire() chamado em todas as operações de leitura
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// ══════════════════════════════════════════════════════════════════════
// CACHE_TTL deve ser 3600 (1 hora) — validamos nas assertions
// ══════════════════════════════════════════════════════════════════════

const CACHE_TTL = 3600;
const PREFIX = 'mirror:source-group:';
const SET_KEY = 'mirror:source-groups:all';

// ══════════════════════════════════════════════════════════════════════
// Fake Redis — captura todas as chamadas de métodos
// ══════════════════════════════════════════════════════════════════════

interface CapturedCall {
  method: string;
  args: unknown[];
}

let calls: CapturedCall[] = [];

class FakeRedisPipeline {
  private ops: CapturedCall[] = [];

  set(key: string, value: string): this {
    this.ops.push({ method: 'set', args: [key, value] });
    return this;
  }

  setex(key: string, ttl: number, value: string): this {
    this.ops.push({ method: 'setex', args: [key, ttl, value] });
    return this;
  }

  del(key: string): this {
    this.ops.push({ method: 'del', args: [key] });
    return this;
  }

  srem(key: string, member: string): this {
    this.ops.push({ method: 'srem', args: [key, member] });
    return this;
  }

  sadd(key: string, member: string): this {
    this.ops.push({ method: 'sadd', args: [key, member] });
    return this;
  }

  async exec(): Promise<unknown[]> {
    calls.push(...this.ops);
    return this.ops.map(() => [null, 'OK'] as [Error | null, string]);
  }
}

let mockStore: Map<string, string> = new Map();

class FakeRedis {
  constructor(_url?: string) { /* no-op */ }
  on = () => {};
  connect = async () => {};
  quit = () => {};

  async get(key: string): Promise<string | null> {
    calls.push({ method: 'get', args: [key] });
    return mockStore.get(key) ?? null;
  }

  async setex(key: string, ttl: number, value: string): Promise<'OK'> {
    calls.push({ method: 'setex', args: [key, ttl, value] });
    mockStore.set(key, value);
    return 'OK';
  }

  async expire(key: string, ttl: number): Promise<number> {
    calls.push({ method: 'expire', args: [key, ttl] });
    return 1;
  }

  async del(key: string): Promise<number> {
    calls.push({ method: 'del', args: [key] });
    mockStore.delete(key);
    return 1;
  }

  async sadd(key: string, member: string): Promise<number> {
    calls.push({ method: 'sadd', args: [key, member] });
    return 1;
  }

  async srem(key: string, member: string): Promise<number> {
    calls.push({ method: 'srem', args: [key, member] });
    return 1;
  }

  async smembers(key: string): Promise<string[]> {
    calls.push({ method: 'smembers', args: [key] });
    return [];
  }

  pipeline(): FakeRedisPipeline {
    return new FakeRedisPipeline();
  }
}

// ══════════════════════════════════════════════════════════════════════
// Mocks — mock.module antes de qualquer import
// ══════════════════════════════════════════════════════════════════════

const mockGetRedis = mock<() => FakeRedis | null>(() => new FakeRedis());
const mockCacheDel = mock<(key: string) => Promise<void>>();

mock.module('../redis.ts', () => ({
  getRedis: mockGetRedis,
  cacheDel: mockCacheDel,
}));

// ══════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════

/** Filtra chamadas por método específico */
function callsByMethod(method: string): CapturedCall[] {
  return calls.filter((c) => c.method === method);
}

/** Retorna o primeiro argumento de uma chamada (key) */
function firstArg(call: CapturedCall): unknown {
  return call.args[0];
}

/** Retorna o segundo argumento de uma chamada (ttl ou valor) */
function secondArg(call: CapturedCall): unknown {
  return call.args[1];
}

// ══════════════════════════════════════════════════════════════════════
// Testes
// ══════════════════════════════════════════════════════════════════════

describe('group-cache — TTL e renovação automática', () => {
  const TEST_JID = '120363000000000001@g.us';
  const TEST_KEY = `${PREFIX}${TEST_JID}`;
  const TEST_AFFILIATE_ID = 42;
  const TEST_GROUP_NAME = 'Grupo Promoções';
  const TEST_ENTRY = JSON.stringify({ affiliateId: TEST_AFFILIATE_ID, groupName: TEST_GROUP_NAME });

  beforeEach(() => {
    calls = [];
    mockStore = new Map();
    mockGetRedis.mockReset();
    mockCacheDel.mockReset();
    mockGetRedis.mockImplementation(() => new FakeRedis());
    mockCacheDel.mockImplementation(async (key: string) => {
      await new FakeRedis().del(key);
    });
  });

  describe('✅ Escrita usa SETEX com TTL=3600', () => {
    it('cacheSourceGroup usa setex() com TTL de 1 hora', async () => {
      const { cacheSourceGroup } = await import('../group-cache.ts');
      await cacheSourceGroup(TEST_JID, TEST_AFFILIATE_ID, TEST_GROUP_NAME);

      const setexCalls = callsByMethod('setex');
      expect(setexCalls.length).toBe(1);
      const c0 = setexCalls[0]!;
      expect(c0.args[0]).toBe(TEST_KEY);
      expect(c0.args[1]).toBe(CACHE_TTL);
      expect(JSON.parse(c0.args[2] as string)).toEqual({
        affiliateId: TEST_AFFILIATE_ID,
        groupName: TEST_GROUP_NAME,
      });
    });

    it('cacheSourceGroup também SADD ao set de todos os grupos', async () => {
      const { cacheSourceGroup } = await import('../group-cache.ts');
      await cacheSourceGroup(TEST_JID, TEST_AFFILIATE_ID);

      const saddCalls = callsByMethod('sadd');
      expect(saddCalls.length).toBe(1);
      expect(saddCalls[0]!.args[0]).toBe(SET_KEY);
      expect(saddCalls[0]!.args[1]).toBe(TEST_JID);
    });

    it('cacheSourceGroup converte groupName vazio para string vazia', async () => {
      const { cacheSourceGroup } = await import('../group-cache.ts');
      await cacheSourceGroup(TEST_JID, TEST_AFFILIATE_ID);

      const setexCalls = callsByMethod('setex');
      const parsed = JSON.parse(setexCalls[0]!.args[2] as string);
      expect(parsed).toEqual({ affiliateId: TEST_AFFILIATE_ID, groupName: '' });
    });

    it('replaceSourceGroups usa SETEX no pipeline com TTL=3600', async () => {
      const { replaceSourceGroups } = await import('../group-cache.ts');
      const oldGroups = [{ jid: 'old@c.us', name: 'Old' }];
      const newGroups = [
        { jid: 'new1@c.us', name: 'Novo 1' },
        { jid: 'new2@c.us', name: 'Novo 2' },
      ];

      await replaceSourceGroups(oldGroups, newGroups, TEST_AFFILIATE_ID);

      const setexCalls = callsByMethod('setex');
      expect(setexCalls.length).toBe(2);

      // Primeiro novo grupo
      const s0 = setexCalls[0]!;
      expect(s0.args[0]).toBe(`${PREFIX}new1@c.us`);
      expect(s0.args[1]).toBe(CACHE_TTL);
      expect(JSON.parse(s0.args[2] as string)).toEqual({
        affiliateId: TEST_AFFILIATE_ID,
        groupName: 'Novo 1',
      });

      // Segundo novo grupo
      const s1 = setexCalls[1]!;
      expect(s1.args[0]).toBe(`${PREFIX}new2@c.us`);
      expect(s1.args[1]).toBe(CACHE_TTL);
      expect(JSON.parse(s1.args[2] as string)).toEqual({
        affiliateId: TEST_AFFILIATE_ID,
        groupName: 'Novo 2',
      });

      // Verifica que o grupo antigo removido foi chamado com del
      const delCalls = callsByMethod('del');
      expect(delCalls.length).toBe(1);
      expect(delCalls[0]!.args[0]).toBe(`${PREFIX}old@c.us`);
    });

    it('replaceSourceGroups mantém grupos em comum entre old e new', async () => {
      const { replaceSourceGroups } = await import('../group-cache.ts');
      const oldGroups = [{ jid: 'common@c.us', name: 'Comum' }];
      const newGroups = [{ jid: 'common@c.us', name: 'Comum Atualizado' }];

      await replaceSourceGroups(oldGroups, newGroups, TEST_AFFILIATE_ID);

      // common@c.us está em ambos, não deve ser removido
      const delCalls = callsByMethod('del');
      expect(delCalls.length).toBe(0);

      // Mas deve ser re-escrito com SETEX
      const setexCalls = callsByMethod('setex');
      expect(setexCalls.length).toBe(1);
      expect(JSON.parse(setexCalls[0]!.args[2] as string)).toEqual({
        affiliateId: TEST_AFFILIATE_ID,
        groupName: 'Comum Atualizado',
      });
    });
  });

  describe('✅ Leitura renova TTL automaticamente', () => {
    beforeEach(() => {
      // Pré-popula o mock store
      mockStore.set(TEST_KEY, TEST_ENTRY);
    });

    it('getAffiliateIdBySourceGroup retorna affiliateId e chama expire() para renovar TTL', async () => {
      const { getAffiliateIdBySourceGroup } = await import('../group-cache.ts');
      const result = await getAffiliateIdBySourceGroup(TEST_JID);

      expect(result).toBe(TEST_AFFILIATE_ID);

      // Verifica GET
      const getCalls = callsByMethod('get');
      expect(getCalls.length).toBe(1);
      expect(getCalls[0]!.args[0]).toBe(TEST_KEY);

      // Verifica EXPIRE — renovação automática
      const expireCalls = callsByMethod('expire');
      expect(expireCalls.length).toBe(1);
      expect(expireCalls[0]!.args[0]).toBe(TEST_KEY);
      expect(expireCalls[0]!.args[1]).toBe(CACHE_TTL);
    });

    it('getSourceGroupInfo retorna objeto completo e chama expire() para renovar TTL', async () => {
      const { getSourceGroupInfo } = await import('../group-cache.ts');
      const result = await getSourceGroupInfo(TEST_JID);

      expect(result).toEqual({ affiliateId: TEST_AFFILIATE_ID, groupName: TEST_GROUP_NAME });

      // Verifica GET
      const getCalls = callsByMethod('get');
      expect(getCalls.length).toBe(1);
      expect(getCalls[0]!.args[0]).toBe(TEST_KEY);

      // Verifica EXPIRE — renovação automática
      const expireCalls = callsByMethod('expire');
      expect(expireCalls.length).toBe(1);
      expect(expireCalls[0]!.args[0]).toBe(TEST_KEY);
      expect(expireCalls[0]!.args[1]).toBe(CACHE_TTL);
    });

    it('getAffiliateIdBySourceGroup retorna null quando chave não existe', async () => {
      const { getAffiliateIdBySourceGroup } = await import('../group-cache.ts');
      const result = await getAffiliateIdBySourceGroup('jid-inexistente@c.us');

      expect(result).toBeNull();

      // GET foi chamado mas expire NÃO (porque raw é null)
      const expireCalls = callsByMethod('expire');
      expect(expireCalls.length).toBe(0);
    });

    it('getSourceGroupInfo retorna null quando chave não existe', async () => {
      const { getSourceGroupInfo } = await import('../group-cache.ts');
      const result = await getSourceGroupInfo('jid-inexistente@c.us');

      expect(result).toBeNull();

      const expireCalls = callsByMethod('expire');
      expect(expireCalls.length).toBe(0);
    });
  });

  describe('✅ TTL padrão é 3600 segundos (1 hora)', () => {
    it('constante CACHE_TTL importada é 3600', async () => {
      // Validamos que o módulo exporta/usa a constante correta
      // Re-importamos o source e verificamos indiretamente via setex
      const { cacheSourceGroup } = await import('../group-cache.ts');
      await cacheSourceGroup(TEST_JID, TEST_AFFILIATE_ID);

      const setexCalls = callsByMethod('setex');
      expect(setexCalls.length).toBe(1);
      expect(setexCalls[0]!.args[1]).toBe(3600);
      expect(setexCalls[0]!.args[1]).toBe(CACHE_TTL);
    });

    it('todas as escritas usam o mesmo TTL', async () => {
      const { cacheSourceGroup, replaceSourceGroups } = await import('../group-cache.ts');

      await cacheSourceGroup('g1@c.us', 1);
      await replaceSourceGroups([], [{ jid: 'g2@c.us', name: 'G2' }], 1);

      const setexCalls = callsByMethod('setex');
      expect(setexCalls.length).toBe(2);
      expect(setexCalls[0]!.args[1]).toBe(setexCalls[1]!.args[1]); // mesmo TTL
      expect(setexCalls[0]!.args[1]).toBe(3600);
    });

    it('expire() nas leituras também usa 3600', async () => {
      mockStore.set(TEST_KEY, TEST_ENTRY);
      const { getAffiliateIdBySourceGroup, getSourceGroupInfo } = await import('../group-cache.ts');

      await getAffiliateIdBySourceGroup(TEST_JID);
      await getSourceGroupInfo(TEST_JID);

      const expireCalls = callsByMethod('expire');
      expect(expireCalls.length).toBe(2);
      expect(expireCalls[0]!.args[1]).toBe(3600);
      expect(expireCalls[1]!.args[1]).toBe(3600);
    });
  });

  describe('✅ Graceful fallback — Redis indisponível', () => {
    it('cacheSourceGroup não lança erro quando getRedis retorna null', async () => {
      mockGetRedis.mockImplementation(() => null);
      const { cacheSourceGroup } = await import('../group-cache.ts');
      await expect(cacheSourceGroup(TEST_JID, TEST_AFFILIATE_ID)).resolves.toBeUndefined();
    });

    it('getAffiliateIdBySourceGroup retorna null quando getRedis retorna null', async () => {
      mockGetRedis.mockImplementation(() => null);
      const { getAffiliateIdBySourceGroup } = await import('../group-cache.ts');
      const result = await getAffiliateIdBySourceGroup(TEST_JID);
      expect(result).toBeNull();
    });

    it('getSourceGroupInfo retorna null quando getRedis retorna null', async () => {
      mockGetRedis.mockImplementation(() => null);
      const { getSourceGroupInfo } = await import('../group-cache.ts');
      const result = await getSourceGroupInfo(TEST_JID);
      expect(result).toBeNull();
    });

    it('replaceSourceGroups não lança erro quando getRedis retorna null', async () => {
      mockGetRedis.mockImplementation(() => null);
      const { replaceSourceGroups } = await import('../group-cache.ts');
      await expect(
        replaceSourceGroups(
          [{ jid: 'old@c.us', name: 'Old' }],
          [{ jid: 'new@c.us', name: 'New' }],
          1,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('✅ Operações de remoção', () => {
    it('removeSourceGroup usa cacheDel + srem', async () => {
      const { removeSourceGroup } = await import('../group-cache.ts');
      await removeSourceGroup(TEST_JID);

      expect(mockCacheDel).toHaveBeenCalledWith(TEST_KEY);

      const sremCalls = callsByMethod('srem');
      expect(sremCalls.length).toBe(1);
      expect(sremCalls[0]!.args[0]).toBe(SET_KEY);
      expect(sremCalls[0]!.args[1]).toBe(TEST_JID);
    });

    it('removeSourceGroups usa pipeline para múltiplos JIDs', async () => {
      const { removeSourceGroups } = await import('../group-cache.ts');
      const jids = ['g1@c.us', 'g2@c.us', 'g3@c.us'];
      await removeSourceGroups(jids);

      const delCalls = callsByMethod('del');
      expect(delCalls.length).toBe(3);
      expect(delCalls[0]!.args[0]).toBe(`${PREFIX}g1@c.us`);
      expect(delCalls[1]!.args[0]).toBe(`${PREFIX}g2@c.us`);
      expect(delCalls[2]!.args[0]).toBe(`${PREFIX}g3@c.us`);

      const sremCalls = callsByMethod('srem');
      expect(sremCalls.length).toBe(3);
    });

    it('removeSourceGroups não faz nada para array vazio', async () => {
      const { removeSourceGroups } = await import('../group-cache.ts');
      await removeSourceGroups([]);

      expect(calls.length).toBe(0);
    });
  });

  describe('✅ Parsing de dados corrompidos', () => {
    it('getAffiliateIdBySourceGroup retorna null para JSON inválido', async () => {
      mockStore.set(TEST_KEY, 'invalid-json{{{');
      const { getAffiliateIdBySourceGroup } = await import('../group-cache.ts');
      const result = await getAffiliateIdBySourceGroup(TEST_JID);
      expect(result).toBeNull();
    });

    it('getSourceGroupInfo retorna null para JSON inválido', async () => {
      mockStore.set(TEST_KEY, 'not-json');
      const { getSourceGroupInfo } = await import('../group-cache.ts');
      const result = await getSourceGroupInfo(TEST_JID);
      expect(result).toBeNull();
    });
  });
});
