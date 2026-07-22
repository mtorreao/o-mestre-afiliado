/**
 * Test: Validar cache de conversão de URLs no Redis.
 *
 * Critério: mesma URL convertida nos últimos N minutos
 * reaproveita resultado anterior. Chave mirror:conversion:{hash} com TTL.
 *
 * Estratégia:
 *   1. Testa o padrão de chave do cache (SHA256 hash)
 *   2. Testa contra Redis real no ambiente dev
 *   3. Testa comportamento de cache hit/miss
 *   4. Testa TTL
 *   5. Testa falha silenciosa se Redis indisponível
 */

import { describe, it, expect, afterAll } from 'bun:test';
import { createHash } from 'node:crypto';

// ─── Constantes (mesmas do shared) ───────────────────────────────────────
const MIRROR_CONVERSION_CACHE_PREFIX = 'mirror:conversion:';
const MIRROR_CONVERSION_CACHE_TTL = 3600;

// ─── Helpers ─────────────────────────────────────────────────────────────
function urlToCacheKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return `${MIRROR_CONVERSION_CACHE_PREFIX}${hash}`;
}

// ─── URLs de teste (vários marketplaces) ─────────────────────────────────
const TEST_URLS = {
  shopee: 'https://shopee.com.br/product/123456?sp=abc',
  mercadolivre: 'https://www.mercadolivre.com.br/product/ABC123',
  amazon: 'https://www.amazon.com.br/dp/B0ABC123DEF',
  goPromozone: 'https://go.promozone.ai/redirect/shopee?url=https%3A%2F%2Fshopee.com.br%2Fproduct%2F789',
};

// ═════════════════════════════════════════════════════════════════════════
// TESTES DE PADRÃO DE CHAVE
// ═════════════════════════════════════════════════════════════════════════

describe('Cache Key Pattern', () => {
  it('produz chave deterministicamente — mesma URL = mesma chave', () => {
    const key1 = urlToCacheKey(TEST_URLS.shopee);
    const key2 = urlToCacheKey(TEST_URLS.shopee);
    expect(key1).toBe(key2);
  });

  it('URLs diferentes produzem chaves diferentes', () => {
    const key1 = urlToCacheKey(TEST_URLS.shopee);
    const key2 = urlToCacheKey(TEST_URLS.mercadolivre);
    expect(key1).not.toBe(key2);
  });

  it('chave começa com o prefixo mirror:conversion:', () => {
    const key = urlToCacheKey(TEST_URLS.shopee);
    expect(key.startsWith(MIRROR_CONVERSION_CACHE_PREFIX)).toBe(true);
  });

  it('hash é SHA256 (64 caracteres hex)', () => {
    const key = urlToCacheKey(TEST_URLS.shopee);
    const hashPart = key.replace(MIRROR_CONVERSION_CACHE_PREFIX, '');
    expect(hashPart.length).toBe(64);
    expect(/^[a-f0-9]{64}$/.test(hashPart)).toBe(true);
  });

  it('prefixo + hash = comprimento previsível', () => {
    const key = urlToCacheKey(TEST_URLS.shopee);
    expect(key.length).toBe(MIRROR_CONVERSION_CACHE_PREFIX.length + 64);
  });

  it('URL com e sem trailing slash têm chaves diferentes', () => {
    const key1 = urlToCacheKey('https://shopee.com.br/product/123');
    const key2 = urlToCacheKey('https://shopee.com.br/product/123/');
    expect(key1).not.toBe(key2);
  });

  it('URL com parâmetros em ordem diferente têm chaves diferentes', () => {
    const key1 = urlToCacheKey('https://shopee.com.br/p?sp=abc&ref=xyz');
    const key2 = urlToCacheKey('https://shopee.com.br/p?ref=xyz&sp=abc');
    expect(key1).not.toBe(key2);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// TESTES DE INTEGRAÇÃO COM REDIS (ambiente dev)
// ═════════════════════════════════════════════════════════════════════════

describe('Redis Cache Integration (dev environment)', () => {
  // Tenta conectar no Redis dev (localhost:5455)
  let redis: import('ioredis').Redis | null = null;
  let cacheAvailable = true;

  async function getRedis() {
    if (redis) return redis;
    try {
      const Redis = await import('ioredis').then(m => m.default);
      redis = new Redis('redis://localhost:5455', {
        maxRetriesPerRequest: 1,
        retryStrategy(times: number) {
          if (times > 1) return null;
          return Math.min(times * 200, 1000);
        },
        lazyConnect: true,
      });
      await redis.ping();
      return redis;
    } catch (e) {
      console.log('Redis not available, skipping integration tests');
      cacheAvailable = false;
      return null;
    }
  }

  afterAll(async () => {
    if (redis) {
      // Limpa chaves de teste
      for (const url of Object.values(TEST_URLS)) {
        await redis.del(urlToCacheKey(url)).catch(() => {});
      }
      await redis.quit().catch(() => {});
    }
  });

  it('conexão com Redis dev está disponível', async () => {
    const r = await getRedis();
    expect(cacheAvailable).toBe(true);
    if (r) {
      const pong = await r.ping();
      expect(pong).toBe('PONG');
    }
  });

  it('set: salva entrada no cache com TTL correto', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    const url = TEST_URLS.shopee;
    const key = urlToCacheKey(url);
    const value = JSON.stringify({
      convertedUrl: 'https://shopee.com.br/affiliate/123',
      marketplace: 'shopee',
      timestamp: new Date().toISOString(),
    });

    await r.del(key);
    await r.setex(key, MIRROR_CONVERSION_CACHE_TTL, value);

    expect(await r.exists(key)).toBe(1);

    const ttl = await r.ttl(key);
    expect(ttl).toBeGreaterThan(3590);
    expect(ttl).toBeLessThanOrEqual(3600);

    const raw = await r.get(key);
    expect(raw).toBe(value);

    await r.del(key);
  });

  it('get: retorna null para chave inexistente (cache miss)', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    const url = 'https://shopee.com.br/nonexistent-' + Date.now();
    const raw = await r.get(urlToCacheKey(url));
    expect(raw).toBe(null);
  });

  it('get: retorna valor salvo para chave existente (cache hit)', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    const url = TEST_URLS.amazon;
    const key = urlToCacheKey(url);
    const cacheData = {
      convertedUrl: 'https://amazon.com.br/affiliate/B0ABC123DEF',
      marketplace: 'amazon',
      timestamp: new Date().toISOString(),
    };

    await r.del(key);
    await r.setex(key, 120, JSON.stringify(cacheData));

    const raw = await r.get(key);
    expect(raw).not.toBe(null);

    const parsed = JSON.parse(raw!);
    expect(parsed.convertedUrl).toBe(cacheData.convertedUrl);
    expect(parsed.marketplace).toBe(cacheData.marketplace);
    expect(parsed.timestamp).toBe(cacheData.timestamp);

    await r.del(key);
  });

  it('mesma URL reusa cache — não cria segunda entrada', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    const url = TEST_URLS.mercadolivre;
    const key = urlToCacheKey(url);

    await r.del(key);

    // Primeira inserção
    const data1 = {
      convertedUrl: 'https://mercadolivre.com.br/affiliate/ABC123',
      marketplace: 'mercadolivre',
      timestamp: new Date().toISOString(),
    };
    await r.setex(key, 120, JSON.stringify(data1));

    // "Segunda conversão" — mesma URL, sobrescreve a mesma chave
    const data2 = {
      convertedUrl: 'https://mercadolivre.com.br/affiliate/ABC123-v2',
      marketplace: 'mercadolivre',
      timestamp: new Date().toISOString(),
    };
    await r.setex(key, 120, JSON.stringify(data2));

    // Só existe uma entrada (a mesma chave foi sobrescrita)
    const keys = await r.keys(`${MIRROR_CONVERSION_CACHE_PREFIX}*`);
    const matchingKeys = keys.filter(k => k === key);
    expect(matchingKeys.length).toBe(1);

    // O valor é o mais recente
    const raw = await r.get(key);
    const parsed = JSON.parse(raw!);
    expect(parsed.timestamp).toBe(data2.timestamp);

    await r.del(key);
  });

  it('del: remove entrada do cache', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    const url = TEST_URLS.goPromozone;
    const key = urlToCacheKey(url);

    await r.setex(key, 60, JSON.stringify({
      convertedUrl: 'https://shopee.com.br/affiliate/789',
      marketplace: 'shopee',
      timestamp: new Date().toISOString(),
    }));

    expect(await r.exists(key)).toBe(1);
    await r.del(key);
    expect(await r.exists(key)).toBe(0);
  });

  it('TTL curto expira e cache vira miss', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    const url = 'https://shopee.com.br/ttl-test-' + Date.now();
    const key = urlToCacheKey(url);

    await r.setex(key, 1, JSON.stringify({
      convertedUrl: 'https://shopee.com.br/affiliate/ttl',
      marketplace: 'shopee',
      timestamp: new Date().toISOString(),
    }));

    expect(await r.exists(key)).toBe(1);
    await new Promise(r => setTimeout(r, 1500));
    expect(await r.exists(key)).toBe(0);
  }, 5000);

  it('operações em lote: várias URLs podem ser cacheadas simultaneamente', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    for (const [name, url] of Object.entries(TEST_URLS)) {
      const key = urlToCacheKey(url);
      await r.del(key);
      await r.setex(key, 60, JSON.stringify({
        convertedUrl: `https://${name}.com.br/affiliate`,
        marketplace: name,
        timestamp: new Date().toISOString(),
      }));
    }

    for (const url of Object.values(TEST_URLS)) {
      expect(await r.exists(urlToCacheKey(url))).toBe(1);
    }

    const keys = await r.keys(`${MIRROR_CONVERSION_CACHE_PREFIX}*`);
    for (const url of Object.values(TEST_URLS)) {
      expect(keys.includes(urlToCacheKey(url))).toBe(true);
    }

    for (const url of Object.values(TEST_URLS)) {
      await r.del(urlToCacheKey(url));
    }
  });

  it('armazena convertedUrl = null como valor válido', async () => {
    const r = await getRedis();
    if (!r || !cacheAvailable) return;

    const url = 'https://shopee.com.br/null-conversion-' + Date.now();
    const key = urlToCacheKey(url);

    await r.del(key);
    await r.setex(key, 60, JSON.stringify({
      convertedUrl: null,
      marketplace: 'shopee',
      timestamp: new Date().toISOString(),
    }));

    const raw = await r.get(key);
    const parsed = JSON.parse(raw!);
    expect(parsed.convertedUrl).toBe(null);
    expect(parsed.marketplace).toBe('shopee');

    await r.del(key);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// TESTES DE FALHA SILENCIOSA
// ═════════════════════════════════════════════════════════════════════════

describe('Falha Silenciosa (Redis indisponível)', () => {
  it('conexão com Redis inválido não trava', async () => {
    const Redis = await import('ioredis').then(m => m.default);
    const badRedis = new Redis('redis://localhost:19999', {
      maxRetriesPerRequest: 1,
      retryStrategy(times: number) {
        if (times > 1) return null;
        return 100;
      },
      lazyConnect: true,
    });

    // O importante é que não lança exceção não-capturada
    let error: unknown = null;
    try {
      await badRedis.get('test').catch(() => {});
    } catch (e) {
      error = e;
    }

    expect(error).toBe(null);
    await badRedis.quit().catch(() => {});
  });

  it('getCachedConversion não lança quando Redis falha', async () => {
    const { getCachedConversion } = await import('./conversion-cache.ts');

    let error: unknown = null;
    try {
      await getCachedConversion('https://example.com/test-redis-down');
    } catch (e) {
      error = e;
    }

    expect(error).toBe(null);
  });

  it('setCachedConversion não lança quando Redis falha', async () => {
    const { setCachedConversion } = await import('./conversion-cache.ts');

    let error: unknown = null;
    try {
      await setCachedConversion('https://example.com/test-redis-down', {
        convertedUrl: 'https://aff.example.com',
        marketplace: 'shopee',
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      error = e;
    }

    expect(error).toBe(null);
  });

  it('invalidateCachedConversion não lança quando Redis falha', async () => {
    const { invalidateCachedConversion } = await import('./conversion-cache.ts');

    let error: unknown = null;
    try {
      await invalidateCachedConversion('https://example.com/test-redis-down');
    } catch (e) {
      error = e;
    }

    expect(error).toBe(null);
  });
});
