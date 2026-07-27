/**
 * Testes do wrapper Redis (redis.ts) com ioredis MOCKADO.
 *
 * Não conectamos a um Redis real — substituímos o módulo `ioredis` por
 * uma implementação fake que registra as chamadas (get/setex/del/xadd/quit)
 * e permite simular valores em cache e erros. Isso cobre cacheGet,
 * cacheSet, cacheDel, streamAdd e closeRedis sem I/O de rede.
 *
 * O módulo redis.ts tem singletons de módulo (client/enabled); como o
 * fake nunca lança no construtor, `enabled` permanece true e podemos
 * importar o módulo uma única vez e limpar o store entre casos.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { config } from '../config.ts';

// Fake Redis client que grava em um Map em memória e registra calls.
class FakeRedis {
  static instance: FakeRedis | null = null;
  store = new Map<string, string>();
  quitCalled = false;
  failGet = false;
  failSet = false;
  failDel = false;
  failXadd = false;

  constructor() {
    FakeRedis.instance = this;
  }

  async get(key: string): Promise<string | null> {
    if (this.failGet) throw new Error('redis down');
    return this.store.has(key) ? this.store.get(key)! : null;
  }

  async setex(key: string, _ttl: number, value: string): Promise<'OK'> {
    if (this.failSet) throw new Error('redis down');
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    if (this.failDel) throw new Error('redis down');
    return this.store.delete(key) ? 1 : 0;
  }

  async xadd(..._args: unknown[]): Promise<string> {
    if (this.failXadd) throw new Error('redis down');
    return '1700000000000-0';
  }

  // noop: o cliente real registra handlers de erro; aqui ignoramos.
  on(): this {
    return this;
  }

  pipeline(): { exec: () => Promise<unknown[]> } {
    return {
      exec: async () => [],
    };
  }

  async quit(): Promise<'OK'> {
    this.quitCalled = true;
    return 'OK';
  }
}

const FakeRedisCtor = FakeRedis as unknown as new () => FakeRedis;

// Aplica o mock de ioredis e importa redis.ts UMA vez (canônico, p/ cobertura).
await mock.module('ioredis', () => ({
  default: FakeRedisCtor,
}));

const api = await import('./redis.ts');

function client(): FakeRedis {
  return api.getRedis() as unknown as FakeRedis;
}

beforeEach(() => {
  process.env.REDIS_URL = 'redis://localhost:5455';
  config.reset();
  FakeRedis.instance = null;
  // força (re)criação do client limpo
  client();
});

afterEach(() => {
  if (FakeRedis.instance) {
    FakeRedis.instance.store.clear();
    FakeRedis.instance.failGet =
      FakeRedis.instance.failSet =
      FakeRedis.instance.failDel =
      FakeRedis.instance.failXadd =
        false;
    FakeRedis.instance.quitCalled = false;
  }
  delete process.env.REDIS_URL;
  config.reset();
});

describe('getRedis', () => {
  it('cria um client quando REDIS_URL definido', () => {
    expect(api.getRedis()).not.toBeNull();
  });

  it('retorna o mesmo singleton em chamadas repetidas', () => {
    const a = api.getRedis();
    const b = api.getRedis();
    expect(a).toBe(b);
  });
});

describe('cacheGet', () => {
  it('retorna valor desserializado do cache', async () => {
    client().store.set('k', JSON.stringify({ a: 1 }));
    const result = await api.cacheGet<{ a: number }>('k');
    expect(result).toEqual({ a: 1 });
  });

  it('null quando chave ausente', async () => {
    expect(await api.cacheGet('missing')).toBeNull();
  });

  it('null quando Redis indisponível (get lança)', async () => {
    client().failGet = true;
    expect(await api.cacheGet('k')).toBeNull();
  });
});

describe('cacheSet', () => {
  it('armazena valor serializado via setex', async () => {
    await api.cacheSet('k', { a: 2 }, 300);
    expect(client().store.get('k')).toBe(JSON.stringify({ a: 2 }));
  });

  it('silencia erro de set', async () => {
    client().failSet = true;
    await expect(api.cacheSet('k', { a: 1 })).resolves.toBeUndefined();
  });
});

describe('cacheDel', () => {
  it('remove a chave', async () => {
    client().store.set('k', 'v');
    await api.cacheDel('k');
    expect(client().store.has('k')).toBe(false);
  });

  it('silencia erro de del', async () => {
    client().failDel = true;
    await expect(api.cacheDel('k')).resolves.toBeUndefined();
  });
});

describe('streamAdd', () => {
  it('retorna o ID gerado pelo xadd', async () => {
    const id = await api.streamAdd('stream:raw', { messageId: 'm1' });
    expect(id).toBe('1700000000000-0');
  });

  it('false quando Redis indisponível (xadd lança)', async () => {
    client().failXadd = true;
    expect(await api.streamAdd('stream:raw', { messageId: 'm1' })).toBe(false);
  });
});

describe('closeRedis', () => {
  it('chama quit no client', async () => {
    const c = client();
    await api.closeRedis();
    expect(c.quitCalled).toBe(true);
  });

  it('sem erro quando não há client', async () => {
    await expect(api.closeRedis()).resolves.toBeUndefined();
  });
});
