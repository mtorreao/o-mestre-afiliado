/**
 * Testes do cache de conversão de URLs em apps/ingestor.
 *
 * Cobre:
 *  - urlToCacheKey (pura): hash SHA-256 determinístico
 *  - getCachedConversion com Redis mockado: hit/miss/parse-error
 *  - setCachedConversion com Redis mockado: TTL customizado via env, TTL padrão
 *  - invalidateCachedConversion com Redis mockado
 *  - Modo degradado (Redis=null): todas as funções viram no-op silencioso
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import {
  getCachedConversion,
  setCachedConversion,
  invalidateCachedConversion,
  _testUrlToCacheKey,
  _setRedisForTest,
  _setEnabledForTest,
  type CachedConversion,
} from './conversion-cache.ts';
import { config } from './config.ts';

// ─── Redis mock helper ─────────────────────────────────────────────────

interface RedisMock {
  get: (key: string) => Promise<string | null>;
  setex: (key: string, ttl: number, value: string) => Promise<string>;
  del: (key: string) => Promise<number>;
}

function makeRedisMock(initialData: Record<string, string> = {}): RedisMock & {
  storage: Record<string, string>;
  setexCalls: Array<{ key: string; ttl: number; value: string }>;
  delCalls: string[];
} {
  const storage = { ...initialData };
  const setexCalls: Array<{ key: string; ttl: number; value: string }> = [];
  const delCalls: string[] = [];

  return {
    storage,
    setexCalls,
    delCalls,
    get: mock(async (key: string) => storage[key] ?? null),
    setex: mock(async (key: string, ttl: number, value: string) => {
      setexCalls.push({ key, ttl, value });
      storage[key] = value;
      return 'OK';
    }),
    del: mock(async (key: string) => {
      delCalls.push(key);
      delete storage[key];
      return 1;
    }),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('urlToCacheKey (pura)', () => {
  it('gera chave com prefixo MIRROR_CONVERSION_CACHE_PREFIX', () => {
    const key = _testUrlToCacheKey('https://example.com/foo');
    expect(key.startsWith('mirror:conversion:')).toBe(true);
  });

  it('mesma URL gera mesma chave (hash determinístico)', () => {
    const url = 'https://shopee.com.br/product-xyz';
    expect(_testUrlToCacheKey(url)).toBe(_testUrlToCacheKey(url));
  });

  it('URLs diferentes geram chaves diferentes', () => {
    const a = _testUrlToCacheKey('https://shopee.com.br/a');
    const b = _testUrlToCacheKey('https://shopee.com.br/b');
    expect(a).not.toBe(b);
  });

  it('diferença de um caractere já muda a chave', () => {
    const a = _testUrlToCacheKey('https://example.com/foo');
    const b = _testUrlToCacheKey('https://example.com/foO');
    expect(a).not.toBe(b);
  });

  it('chave tem 64 chars hex após o prefixo (SHA-256)', () => {
    const key = _testUrlToCacheKey('https://example.com');
    const hash = key.replace('mirror:conversion:', '');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('getCachedConversion — com Redis mockado', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
  });

  afterEach(() => {
    _setRedisForTest(null);
    _setEnabledForTest(true);
  });

  it('retorna null quando chave não existe no Redis', async () => {
    const result = await getCachedConversion('https://example.com/miss');
    expect(result).toBeNull();
  });

  it('retorna o objeto parseado quando chave existe', async () => {
    const url = 'https://shopee.com.br/product';
    const cached: CachedConversion = {
      convertedUrl: 'https://shp.ee/abc',
      marketplace: 'shopee',
      timestamp: '2026-07-27T10:00:00.000Z',
    };
    mockRedis.storage[_testUrlToCacheKey(url)] = JSON.stringify(cached);

    const result = await getCachedConversion(url);
    expect(result).toEqual(cached);
  });

  it('retorna null quando JSON.parse falha (dados corrompidos)', async () => {
    const url = 'https://shopee.com.br/product';
    mockRedis.storage[_testUrlToCacheKey(url)] = 'not-valid-json{';

    const result = await getCachedConversion(url);
    expect(result).toBeNull();
  });

  it('usa a chave derivada de urlToCacheKey', async () => {
    const url = 'https://example.com/x';
    await getCachedConversion(url);
    expect(mockRedis.get).toHaveBeenCalledTimes(1);
    // Acessa .mock.calls via cast — TS perde a info de mock após o
    // double-cast que injeta no Redis real.
    const calls = (mockRedis.get as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const calledKey = (calls[0] as [string])[0];
    expect(calledKey).toBe(_testUrlToCacheKey(url));
  });
});

describe('getCachedConversion — modo degradado (Redis=null)', () => {
  beforeEach(() => {
    _setRedisForTest(null);
  });

  it('retorna null sem tentar consultar Redis', async () => {
    const result = await getCachedConversion('https://example.com');
    expect(result).toBeNull();
  });
});

describe('setCachedConversion — com Redis mockado', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
  });

  afterEach(() => {
    _setRedisForTest(null);
    delete process.env.WORKER_CONVERSION_CACHE_TTL;
  });

  it('serializa o objeto e chama setex com a chave correta', async () => {
    const url = 'https://shopee.com.br/product';
    const cached: CachedConversion = {
      convertedUrl: 'https://shp.ee/abc',
      marketplace: 'shopee',
      timestamp: '2026-07-27T10:00:00.000Z',
    };

    await setCachedConversion(url, cached);

    expect(mockRedis.setex).toHaveBeenCalledTimes(1);
    const call = mockRedis.setexCalls[0]!;
    expect(call.key).toBe(_testUrlToCacheKey(url));
    expect(call.value).toBe(JSON.stringify(cached));
    // TTL padrão do @omestre/shared → 3600 (1h)
    expect(call.ttl).toBe(3600);
  });

  it('usa TTL customizado de WORKER_CONVERSION_CACHE_TTL', async () => {
    process.env.WORKER_CONVERSION_CACHE_TTL = '120';
    config.reset();
    const url = 'https://example.com/x';
    await setCachedConversion(url, {
      convertedUrl: null,
      marketplace: 'unknown',
      timestamp: '2026-07-27T10:00:00.000Z',
    });
    expect(mockRedis.setexCalls[0]!.ttl).toBe(120);
  });

  it('faz parse correto de WORKER_CONVERSION_CACHE_TTL', async () => {
    process.env.WORKER_CONVERSION_CACHE_TTL = '900';
    config.reset();
    const url = 'https://example.com/y';
    await setCachedConversion(url, {
      convertedUrl: null,
      marketplace: 'shopee',
      timestamp: '2026-07-27T10:00:00.000Z',
    });
    expect(mockRedis.setexCalls[0]!.ttl).toBe(900);
  });

  it('aceita convertedUrl null', async () => {
    await setCachedConversion('https://example.com', {
      convertedUrl: null,
      marketplace: 'shopee',
      timestamp: '2026-07-27T10:00:00.000Z',
    });
    const parsed = JSON.parse(mockRedis.setexCalls[0]!.value);
    expect(parsed.convertedUrl).toBeNull();
  });
});

describe('setCachedConversion — modo degradado', () => {
  beforeEach(() => {
    _setRedisForTest(null);
  });

  it('não lança erro quando Redis é null', async () => {
    await expect(
      setCachedConversion('https://example.com', {
        convertedUrl: null,
        marketplace: 'shopee',
        timestamp: '2026-07-27T10:00:00.000Z',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('invalidateCachedConversion — com Redis mockado', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
  });

  afterEach(() => {
    _setRedisForTest(null);
  });

  it('deleta a chave correspondente', async () => {
    const url = 'https://example.com/x';
    const key = _testUrlToCacheKey(url);
    mockRedis.storage[key] = '{}';

    await invalidateCachedConversion(url);

    expect(mockRedis.delCalls).toContain(key);
    expect(mockRedis.storage[key]).toBeUndefined();
  });

  it('usa a chave derivada de urlToCacheKey', async () => {
    const url = 'https://example.com/y';
    await invalidateCachedConversion(url);
    expect(mockRedis.delCalls[0]).toBe(_testUrlToCacheKey(url));
  });
});

describe('invalidateCachedConversion — modo degradado', () => {
  beforeEach(() => {
    _setRedisForTest(null);
  });

  it('não lança erro quando Redis é null', async () => {
    await expect(invalidateCachedConversion('https://example.com')).resolves.toBeUndefined();
  });
});

describe('integração — roundtrip set/get', () => {
  let mockRedis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    mockRedis = makeRedisMock();
    _setRedisForTest(mockRedis as unknown as Parameters<typeof _setRedisForTest>[0]);
  });

  afterEach(() => {
    _setRedisForTest(null);
  });

  it('setCachedConversion + getCachedConversion retornam o mesmo objeto', async () => {
    const url = 'https://shopee.com.br/roundtrip';
    const cached: CachedConversion = {
      convertedUrl: 'https://shp.ee/abc',
      marketplace: 'shopee',
      timestamp: '2026-07-27T10:00:00.000Z',
    };

    await setCachedConversion(url, cached);
    const retrieved = await getCachedConversion(url);
    expect(retrieved).toEqual(cached);
  });

  it('invalidateCachedConversion remove o cache', async () => {
    const url = 'https://shopee.com.br/invalidate';
    await setCachedConversion(url, {
      convertedUrl: 'https://shp.ee/abc',
      marketplace: 'shopee',
      timestamp: '2026-07-27T10:00:00.000Z',
    });
    expect(await getCachedConversion(url)).not.toBeNull();

    await invalidateCachedConversion(url);
    expect(await getCachedConversion(url)).toBeNull();
  });
});
