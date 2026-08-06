/**
 * Testes de autenticação — parseBasicAuth, safeEqual, sessões.
 *
 * As funções de sessão (`createSession`/`isValidSession`/`destroySession`)
 * são injetáveis: os testes injetam um `SessionRepository` e um cache
 * in-memory via `setAuthDepsForTesting`, evitando DB/Redis reais.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createSession,
  destroySession,
  hashPassword,
  isValidSession,
  parseBasicAuth,
  resetAuthDepsForTesting,
  safeEqual,
  setAuthDepsForTesting,
  sha256Hex,
  verifyPassword,
} from './auth.ts';
import type { SessionRepository } from './db/sessionRepository.ts';

/** Cache fake — Map em memória. Simula Redis. */
function makeInMemoryCache() {
  const store = new Map<string, string>();
  return {
    cache: {
      async get(id: string) {
        const raw = store.get(id);
        if (!raw) return null;
        try {
          const parsed = JSON.parse(raw) as { id: string; email: string; expiresAt: string };
          if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
          return parsed;
        } catch {
          return null;
        }
      },
      async set(s: { id: string; email: string; expiresAt: string }) {
        store.set(s.id, JSON.stringify(s));
      },
      async invalidate(id: string) {
        store.delete(id);
      },
    },
    store,
  };
}

/**
 * Repo fake — aceita um Map externo como store. Permite simular restart:
 * o store (Postgres) persiste, mas o repo+cache (in-memory) são recriados.
 */
function makeInMemoryRepo(externalStore?: Map<string, unknown>) {
  const store = externalStore ?? new Map();
  const repo: Pick<SessionRepository, 'create' | 'findValidById' | 'deleteById' | 'deleteExpired'> =
    {
      async create(input) {
        const now = new Date();
        const row = {
          id: input.id,
          email: input.email,
          csrfToken: input.csrfToken,
          encryptedPayload: input.encryptedPayload,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          expiresAt: input.expiresAt,
          createdAt: now,
          lastSeenAt: now,
        };
        store.set(input.id, row);
        return row as ReturnType<SessionRepository['create']> extends Promise<infer R> ? R : never;
      },
      async findValidById(id, now = new Date()) {
        const row = store.get(id) as
          | {
              id: string;
              email: string;
              csrfToken: string;
              encryptedPayload: string;
              ipAddress: string | null;
              userAgent: string | null;
              expiresAt: Date;
              createdAt: Date;
              lastSeenAt: Date;
            }
          | undefined;
        if (!row) return null;
        if (row.expiresAt.getTime() <= now.getTime()) return null;
        return row as ReturnType<SessionRepository['findValidById']> extends Promise<infer R>
          ? R
          : never;
      },
      async deleteById(id) {
        store.delete(id);
      },
      async deleteExpired(now = new Date()) {
        let n = 0;
        for (const [id, row] of store) {
          const r = row as { expiresAt: Date };
          if (r.expiresAt.getTime() <= now.getTime()) {
            store.delete(id);
            n++;
          }
        }
        return n;
      },
    };
  return { repo: repo as SessionRepository, store };
}

describe('parseBasicAuth', () => {
  test('parse válido (user:pass)', () => {
    const header = 'Basic ' + Buffer.from('admin:senha123').toString('base64');
    expect(parseBasicAuth(header)).toEqual({ user: 'admin', password: 'senha123' });
  });

  test('aceita senha com dois-pontos', () => {
    const header = 'Basic ' + Buffer.from('admin:se:nha').toString('base64');
    expect(parseBasicAuth(header)).toEqual({ user: 'admin', password: 'se:nha' });
  });

  test('retorna null sem prefixo Basic', () => {
    expect(parseBasicAuth('Bearer abc')).toBeNull();
    expect(parseBasicAuth(undefined)).toBeNull();
  });

  test('retorna null para base64 inválido', () => {
    expect(parseBasicAuth('Basic !!!not-base64!!!')).toBeNull();
  });

  test('retorna null se não tem dois-pontos', () => {
    const header = 'Basic ' + Buffer.from('semcolon').toString('base64');
    expect(parseBasicAuth(header)).toBeNull();
  });
});

describe('safeEqual', () => {
  test('iguais → true', () => {
    expect(safeEqual('admin', 'admin')).toBe(true);
  });

  test('diferentes → false', () => {
    expect(safeEqual('admin', 'Admin')).toBe(false);
  });

  test('comprimentos diferentes → false (sem throw)', () => {
    expect(safeEqual('a', 'ab')).toBe(false);
  });

  test('vazios → true', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('sha256Hex', () => {
  test('hash estável de string conhecida', () => {
    // sha256("") — valor de referência conhecido.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('hashPassword / verifyPassword (argon2id)', () => {
  test('hash gera formato $argon2id$', async () => {
    const hash = await hashPassword('senha-forte-123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  test('verify aceita senha correta', async () => {
    const hash = await hashPassword('senha-forte-123');
    expect(await verifyPassword('senha-forte-123', hash)).toBe(true);
  });

  test('verify rejeita senha errada', async () => {
    const hash = await hashPassword('senha-forte-123');
    expect(await verifyPassword('senha-errada', hash)).toBe(false);
  });
});

describe('sessões (Postgres + Redis cache)', () => {
  let store: ReturnType<typeof makeInMemoryRepo>['store'];
  let cacheStore: ReturnType<typeof makeInMemoryCache>['store'];

  beforeEach(() => {
    const r = makeInMemoryRepo();
    const c = makeInMemoryCache();
    store = r.store;
    cacheStore = c.store;
    setAuthDepsForTesting({ sessionRepo: r.repo, cache: c.cache });
  });

  afterEach(() => {
    resetAuthDepsForTesting();
  });

  test('createSession gera token de 64 chars hex', async () => {
    const token = await createSession();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  test('createSession persiste no Postgres fake', async () => {
    const token = await createSession({ email: 'admin' });
    expect(store.has(token)).toBe(true);
    expect(store.get(token)!.email).toBe('admin');
  });

  test('createSession popula cache Redis fake', async () => {
    const token = await createSession();
    expect(cacheStore.has(token)).toBe(true);
  });

  test('isValidSession aceita token recém-criado', async () => {
    const token = await createSession();
    expect(await isValidSession(token)).toBe(true);
  });

  test('isValidSession re-popula cache após eviction', async () => {
    const token = await createSession();
    // Simula cache eviction
    cacheStore.delete(token);
    // Primeira leitura: cache miss → vai no Postgres → re-popula cache
    expect(await isValidSession(token)).toBe(true);
    // Segunda leitura: cache hit
    expect(await isValidSession(token)).toBe(true);
    expect(cacheStore.has(token)).toBe(true);
  });

  test('isValidSession retorna false para token inexistente', async () => {
    expect(await isValidSession('token-que-nao-existe')).toBe(false);
  });

  test('isValidSession retorna false para token expirado (cache miss)', async () => {
    const token = await createSession();
    // Força expiração no Postgres
    const row = store.get(token)!;
    row.expiresAt = new Date(Date.now() - 1000);
    // Limpa cache para forçar fallback no Postgres
    cacheStore.delete(token);
    expect(await isValidSession(token)).toBe(false);
  });

  test('destroySession invalida Postgres + cache', async () => {
    const token = await createSession();
    expect(store.has(token)).toBe(true);
    expect(cacheStore.has(token)).toBe(true);

    await destroySession(token);

    expect(store.has(token)).toBe(false);
    expect(cacheStore.has(token)).toBe(false);
    expect(await isValidSession(token)).toBe(false);
  });

  test('SESSÃO SOBREVIVE A RESTART DO PROCESSO (cenário real)', async () => {
    // 1. Cria sessão no "processo A"
    const token = await createSession({ email: 'admin' });
    expect(await isValidSession(token)).toBe(true);

    // 2. Simula restart: Postgres (store) persiste, mas criamos um repo
    //    NOVO que aponta pro MESMO store, e um cache NOVO vazio.
    resetAuthDepsForTesting();
    const newRepo = makeInMemoryRepo(store); // reaproveita o store do "Postgres"
    const newCache = makeInMemoryCache(); // cache vazio (simula Redis vazio)
    setAuthDepsForTesting({
      sessionRepo: newRepo.repo,
      cache: newCache.cache,
    });

    // 3. Token continua válido mesmo sem cache
    expect(await isValidSession(token)).toBe(true);
    // 4. Cache foi re-populado pela leitura
    expect(newCache.store.has(token)).toBe(true);
  });
});
