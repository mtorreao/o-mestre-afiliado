/**
 * Testes do Rate Limiter do Dispatcher.
 *
 * Cobre:
 *  - Funções puras: rateLimitKey, subRateLimitKey, msUntilWindowEnd
 *  - tryAcquireSlot / tryAcquireGroupSlot com Redis mockado
 *  - waitForSlot / waitForGroupSlot (com Redis mockado + timeout curto)
 *  - Modo degradado (Redis=null → acquired=true direto)
 *  - clearInstanceConfigCache
 *  - Comportamento quando enabled=false
 *
 * As funções de I/O (getInstanceConfig, Redis lazy connect) são
 * controladas via `_setRedisForTest()` e `_setEnabledForTest()` para
 * isolar o estado entre testes.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock do @omestre/db para evitar conexão real com o banco
// DEVE ser chamado antes de importar rate-limiter.ts
mock.module('@omestre/db', () => ({
  WhatsAppInstanceRepository: mock(() => ({
    findByInstanceName: mock(() => Promise.resolve(null)),
  })),
}));

// Importa dinamicamente após o mock estar configurado
const {
  tryAcquireSlot,
  tryAcquireGroupSlot,
  waitForSlot,
  waitForGroupSlot,
  clearInstanceConfigCache,
  _testRateLimitKey,
  _testSubRateLimitKey,
  _testMsUntilWindowEnd,
  _setRedisForTest,
  _setEnabledForTest,
  _setInstanceRepoForTest,
} = await import('./rate-limiter.ts');

// ─── Redis mock helper ──────────────────────────────────────────────────

interface RedisMock {
  incr: (key: string) => Promise<number>;
  expire: (key: string, ttl: number) => Promise<number>;
}

/**
 * Cria um Redis mock que conta `incr` por chave e devolve expire=1.
 * `incrCounts` permite pré-popular contagens para simular janela já em uso.
 */
function makeRedisMock(initialCounts: Record<string, number> = {}): RedisMock & {
  incrCounts: Record<string, number>;
} {
  const incrCounts = { ...initialCounts };
  return {
    incrCounts,
    incr: mock(async (key: string) => {
      incrCounts[key] = (incrCounts[key] ?? 0) + 1;
      return incrCounts[key]!;
    }),
    expire: mock(async () => 1),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('rateLimitKey (pura)', () => {
  it('formata chave com instanceName e windowIndex', () => {
    // Janela de 60s → index muda a cada 60s
    const before = Math.floor(Date.now() / 60_000);
    const key = _testRateLimitKey('inst-1', 60);
    expect(key).toMatch(/^mirror:ratelimit:inst-1:\d+$/);
    const after = Math.floor(Date.now() / 60_000);
    const idx = Number(key.split(':').pop());
    expect(idx >= before && idx <= after).toBe(true);
  });

  it('inclui instanceName na chave', () => {
    const key = _testRateLimitKey('my-instance', 60);
    expect(key).toContain('my-instance');
  });

  it('diferentes windowSec produzem diferentes escalas de index', () => {
    const key5s = _testRateLimitKey('inst', 5);
    const key300s = _testRateLimitKey('inst', 300);
    // Janela 5s: index cresce ~60x mais rápido que 300s
    const idx5 = Number(key5s.split(':').pop());
    const idx300 = Number(key300s.split(':').pop());
    expect(idx5).toBeGreaterThanOrEqual(idx300);
  });

  it('rota a chave conforme a janela passa', () => {
    // Janela de 1s: índice muda a cada segundo
    const idx1 = Math.floor(Date.now() / 1000);
    const k1 = _testRateLimitKey('inst', 1);
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const k2 = _testRateLimitKey('inst', 1);
        const idx2 = Math.floor(Date.now() / 1000);
        if (idx2 > idx1) {
          expect(k1).not.toBe(k2);
        }
        resolve();
      }, 1100);
    });
  });
});

describe('subRateLimitKey (pura)', () => {
  it('formata chave com prefixo "group:"', () => {
    const key = _testSubRateLimitKey('group@g.us', 60);
    expect(key).toMatch(/^mirror:ratelimit:group:group@g\.us:\d+$/);
  });

  it('diferentes jids produzem diferentes chaves', () => {
    const a = _testSubRateLimitKey('group-a@g.us', 60);
    const b = _testSubRateLimitKey('group-b@g.us', 60);
    expect(a).not.toBe(b);
  });
});

describe('msUntilWindowEnd (pura)', () => {
  it('retorna valor entre 1 e windowMs', () => {
    const windowSec = 60;
    const ms = _testMsUntilWindowEnd(windowSec);
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(windowSec * 1000);
  });

  it('janelas menores têm menor tempo até o fim', () => {
    // Duas leituras próximas no tempo — janelas menores sempre têm
    // msUntilWindowEnd <= janelas maiores.
    const ms1s = _testMsUntilWindowEnd(1);
    const ms60s = _testMsUntilWindowEnd(60);
    expect(ms1s).toBeLessThanOrEqual(ms60s);
  });
});

describe('tryAcquireSlot — com Redis mockado', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
    _setEnabledForTest(true);
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);
  });

  afterEach(() => {
    _setRedisForTest(null);
    _setEnabledForTest(true);
    _setInstanceRepoForTest(null);
    clearInstanceConfigCache('inst-1');
  });

  it('adquire slot quando count <= maxMsgs (default 15)', async () => {
    const result = await tryAcquireSlot('inst-1');
    expect(result.acquired).toBe(true);
    expect(result.waitMs).toBe(0);
  });

  it('incrementa o contador no Redis', async () => {
    await tryAcquireSlot('inst-1');
    expect(Object.keys(mockRedis.incrCounts)).toHaveLength(1);
    const key = Object.keys(mockRedis.incrCounts)[0]!;
    expect(mockRedis.incrCounts[key]).toBe(1);
  });

  it('chama expire na primeira incrementação (count===1)', async () => {
    await tryAcquireSlot('inst-1');
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
  });

  it('recusa slot quando count > maxMsgs', async () => {
    // Pré-popula contador em 20 (acima do default 15)
    const now = Date.now();
    const windowSec = 300; // default
    const windowIndex = Math.floor(now / (windowSec * 1000));
    const key = `mirror:ratelimit:inst-1:${windowIndex}`;
    mockRedis.incrCounts[key] = 20;

    const result = await tryAcquireSlot('inst-1');
    expect(result.acquired).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
  });

  it('retorna waitMs com floor de 100ms (Math.max(waitMs, 100))', async () => {
    // Forçar cenário onde waitMs seria < 100ms
    const now = Date.now();
    const windowSec = 300;
    const windowIndex = Math.floor(now / (windowSec * 1000));
    const key = `mirror:ratelimit:inst-1:${windowIndex}`;
    mockRedis.incrCounts[key] = 99; // bem acima do max

    const result = await tryAcquireSlot('inst-1');
    expect(result.waitMs).toBeGreaterThanOrEqual(100);
  });
});

describe('tryAcquireSlot — modo degradado (Redis=null)', () => {
  beforeEach(() => {
    _setRedisForTest(null);
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);
  });

  afterEach(() => {
    _setRedisForTest(null);
    _setEnabledForTest(true);
    _setInstanceRepoForTest(null);
    clearInstanceConfigCache('inst-1');
  });

  it('retorna acquired=true quando Redis não está disponível', async () => {
    // Como Redis não está configurado, rate limiter permite tudo
    // (fail-open para não bloquear envios por falha de infra)
    const result = await tryAcquireSlot('inst-1');
    expect(result.acquired).toBe(true);
    expect(result.waitMs).toBe(0);
  });
});

describe('tryAcquireSlot — enabled=false', () => {
  it('retorna acquired=true mesmo com Redis mockado', async () => {
    const mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
    _setEnabledForTest(false);
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);

    try {
      const result = await tryAcquireSlot('inst-1');
      expect(result.acquired).toBe(true);
      // incr NÃO é chamado porque enabled=false → getRateLimiterRedis retorna null
      expect(mockRedis.incr).toHaveBeenCalledTimes(0);
    } finally {
      _setRedisForTest(null);
      _setEnabledForTest(true);
      _setInstanceRepoForTest(null);
      clearInstanceConfigCache('inst-1');
    }
  });
});

describe('tryAcquireGroupSlot', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
    _setEnabledForTest(true);
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);
  });

  afterEach(() => {
    _setRedisForTest(null);
    _setEnabledForTest(true);
    _setInstanceRepoForTest(null);
  });

  it('adquire slot quando count <= maxMsgs customizado', async () => {
    const result = await tryAcquireGroupSlot('group@g.us', 5, 60);
    expect(result.acquired).toBe(true);
    expect(result.waitMs).toBe(0);
  });

  it('recusa slot quando count > maxMsgs customizado', async () => {
    const now = Date.now();
    const windowSec = 60;
    const windowIndex = Math.floor(now / (windowSec * 1000));
    const key = `mirror:ratelimit:group:group@g.us:${windowIndex}`;
    mockRedis.incrCounts[key] = 10;

    const result = await tryAcquireGroupSlot('group@g.us', 5, 60);
    expect(result.acquired).toBe(false);
    expect(result.waitMs).toBeGreaterThan(0);
  });

  it('chama expire na primeira incrementação', async () => {
    await tryAcquireGroupSlot('group@g.us', 5, 60);
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
  });

  it('incrementa chave com prefixo "group:"', async () => {
    await tryAcquireGroupSlot('group@g.us', 5, 60);
    const keys = Object.keys(mockRedis.incrCounts);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain('mirror:ratelimit:group:group@g.us');
  });

  it('modo degradado: retorna acquired=true sem consultar Redis', async () => {
    _setRedisForTest(null);
    const result = await tryAcquireGroupSlot('group@g.us', 5, 60);
    expect(result.acquired).toBe(true);
  });
});

describe('waitForSlot', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
    _setEnabledForTest(true);
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);
  });

  afterEach(() => {
    _setRedisForTest(null);
    _setEnabledForTest(true);
    _setInstanceRepoForTest(null);
    clearInstanceConfigCache('wait-inst');
  });

  it('retorna true imediatamente quando slot já está disponível', async () => {
    const result = await waitForSlot('wait-inst', 1000);
    expect(result).toBe(true);
  });

  it('retorna true no modo degradado (Redis=null)', async () => {
    _setRedisForTest(null);
    // maxTotalWaitMs precisa ser > 500ms (sleep inicial) para o loop executar
    // e o tryAcquireSlot ser chamado. Em modo degradado, ele retorna
    // acquired=true imediatamente, então sai do loop no primeiro poll.
    const result = await waitForSlot('wait-inst', 1500);
    expect(result).toBe(true);
  });

  it('retorna false quando timeout expira antes de conseguir slot', async () => {
    // Bloqueia Redis para que incr sempre retorne > maxMsgs
    const blockingMock = {
      incr: mock(async () => 9999),
      expire: mock(async () => 1),
    };
    _setRedisForTest(blockingMock as unknown as Parameters<typeof _setRedisForTest>[0]);

    // maxTotalWaitMs curto: vai dar timeout no loop
    const start = Date.now();
    const result = await waitForSlot('wait-inst', 600); // < 500ms (sleep inicial) + 1 poll
    const elapsed = Date.now() - start;
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(3000); // sanity check
  });
});

describe('waitForGroupSlot', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
    _setEnabledForTest(true);
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);
  });

  afterEach(() => {
    _setRedisForTest(null);
    _setEnabledForTest(true);
    _setInstanceRepoForTest(null);
  });

  it('retorna true quando slot está disponível', async () => {
    const result = await waitForGroupSlot('group@g.us', 5, 60, 1000);
    expect(result).toBe(true);
  });

  it('retorna false em timeout com slot bloqueado', async () => {
    const blockingMock = {
      incr: mock(async () => 9999),
      expire: mock(async () => 1),
    };
    _setRedisForTest(blockingMock as unknown as Parameters<typeof _setRedisForTest>[0]);

    const result = await waitForGroupSlot('group@g.us', 5, 60, 600);
    expect(result).toBe(false);
  });
});

describe('clearInstanceConfigCache', () => {
  beforeEach(() => {
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);
  });

  afterEach(() => {
    _setInstanceRepoForTest(null);
  });

  it('não lança erro quando cache está vazio para a instância', () => {
    expect(() => clearInstanceConfigCache('inst-inexistente')).not.toThrow();
  });

  it('limpa cache para a instância específica (não afeta outras)', async () => {
    // Popula cache tentando adquirir slots em 2 instâncias
    const mockA = makeRedisMock();
    const mockB = makeRedisMock();

    _setRedisForTest(mockA as unknown as Parameters<typeof _setRedisForTest>[0]);
    await tryAcquireSlot('inst-A');

    _setRedisForTest(mockB as unknown as Parameters<typeof _setRedisForTest>[0]);
    await tryAcquireSlot('inst-B');

    // Limpa só A
    clearInstanceConfigCache('inst-A');

    // Tentar usar A de novo recria cache → ok
    _setRedisForTest(mockA as unknown as Parameters<typeof _setRedisForTest>[0]);
    const result = await tryAcquireSlot('inst-A');
    expect(result.acquired).toBe(true);

    // cleanup
    _setRedisForTest(null);
    clearInstanceConfigCache('inst-A');
    clearInstanceConfigCache('inst-B');
  });
});

describe('integração — rateLimitKey + tryAcquireSlot', () => {
  beforeEach(() => {
    _setInstanceRepoForTest({
      findByInstanceName: async () => null,
    } as any);
  });

  afterEach(() => {
    _setInstanceRepoForTest(null);
  });

  it('chaves geradas pela função pura são as mesmas usadas em tryAcquireSlot', async () => {
    const mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
    _setEnabledForTest(true);

    try {
      // Captura a chave antes de chamar
      const expectedKey = _testRateLimitKey('inst-x', 300);

      await tryAcquireSlot('inst-x');

      // A chave em incrCounts deve bater com a chave pura
      const keys = Object.keys(mockRedis.incrCounts);
      expect(keys).toContain(expectedKey);
    } finally {
      _setRedisForTest(null);
      _setEnabledForTest(true);
      clearInstanceConfigCache('inst-x');
    }
  });
});
