/**
 * Testes do MlAffiliateRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * select/insert/update/delete encadeáveis. Também mocka o módulo crypto.ts
 * para que encrypt/decrypt sejam funções identidade (retornam o próprio input).
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { MlAffiliate } from './mlAffiliates.repository.ts';

/** Cria um fake Db client com valores padrão que podem ser sobrescritos. */
function fakeDb(over: any = {}) {
  return {
    select:
      over.select ??
      (() => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
          orderBy: () => Promise.resolve([]),
        }),
      })),
    insert:
      over.insert ??
      (() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) })),
    update:
      over.update ??
      (() => ({
        set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
      })),
    delete:
      over.delete ?? (() => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) })),
  };
}

// Mock crypto.ts ANTES de importar o repositório — encrypt/decrypt viram identidade
await mock.module('../crypto.ts', () => ({
  encrypt: (v: string | null | undefined) => v ?? null,
  decrypt: (v: string | null | undefined) => v ?? null,
}));

// Mock getDb ANTES de importar o repositório
await mock.module('../db.ts', () => ({
  getDb: () => fakeDb(),
}));

const { MlAffiliateRepository } = await import('./mlAffiliates.repository.ts');
const repo = new MlAffiliateRepository();

describe('MlAffiliateRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({
      getDb: () => fakeDb(),
    }));
  });

  describe('findAll', () => {
    it('retorna lista vazia quando não há afiliados', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({
                where: () => ({ limit: () => Promise.resolve([]) }),
                orderBy: () => Promise.resolve([]),
              }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().findAll();
      expect(r).toEqual([]);
    });

    it('retorna lista de sumários', async () => {
      const now = new Date();
      const fakeRows = [
        {
          id: 1,
          mlUserId: 'ml-1',
          nickname: 'Loja A',
          accessToken: 'tok1',
          refreshToken: 'rtok1',
          expiresAt: new Date(now.getTime() + 3600000),
          connectedAt: now,
          lastUsedAt: now,
          userId: null,
          meliid: null,
          melitat: null,
          sessionCookies: null,
        },
      ] as MlAffiliate[];
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({
                where: () => ({ limit: () => Promise.resolve(fakeRows) }),
                orderBy: () => Promise.resolve(fakeRows),
              }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().findAll();
      expect(r).toHaveLength(1);
      expect(r[0]!.mlUserId).toBe('ml-1');
      expect(r[0]!.expired).toBe(false);
    });
  });

  describe('findByUserId', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().findByUserId('ml-inexistente');
      expect(r).toBeNull();
    });

    it('retorna o afiliado e descriptografa sessionCookies', async () => {
      const fakeRow = {
        id: 1,
        mlUserId: 'ml-1',
        nickname: 'Loja',
        sessionCookies: 'crypto-data',
      } as MlAffiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().findByUserId('ml-1');
      expect(r).toEqual({ ...fakeRow, sessionCookies: 'crypto-data' });
    });
  });

  describe('findByPlatformUserId', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().findByPlatformUserId(999);
      expect(r).toBeNull();
    });

    it('retorna o afiliado e descriptografa sessionCookies', async () => {
      const fakeRow = { id: 1, userId: 5, sessionCookies: 'crypto-data' } as MlAffiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().findByPlatformUserId(5);
      expect(r).toEqual(fakeRow);
    });
  });

  describe('upsert', () => {
    it('cria novo afiliado quando não existe', async () => {
      const data = {
        mlUserId: 'ml-novo',
        nickname: 'Nova Loja',
        accessToken: 'tok1',
        refreshToken: 'rtok1',
        expiresIn: 3600,
      };
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            // Não encontrou → insert
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
            insert: () => ({
              values: () => ({
                returning: () => Promise.resolve([{ id: 1, ...data, sessionCookies: null }]),
              }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().upsert(data);
      expect(r).toBeDefined();
      expect(r.id).toBe(1);
    });

    it('atualiza afiliado existente', async () => {
      const existing = {
        id: 1,
        mlUserId: 'ml-existente',
        nickname: 'Velha Loja',
        accessToken: 'old-tok',
        refreshToken: 'old-rtok',
        sessionCookies: 'crypto',
      } as unknown as MlAffiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([existing]) }) }),
            }),
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: () =>
                    Promise.resolve([
                      {
                        id: 1,
                        mlUserId: 'ml-existente',
                        nickname: 'Nova Loja',
                        accessToken: 'new-tok',
                        refreshToken: 'new-rtok',
                        sessionCookies: null,
                      },
                    ]),
                }),
              }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().upsert({
        mlUserId: 'ml-existente',
        nickname: 'Nova Loja',
        accessToken: 'new-tok',
        refreshToken: 'new-rtok',
        expiresIn: 7200,
      });
      expect(r).toBeDefined();
      expect(r.nickname).toBe('Nova Loja');
    });
  });

  describe('patch', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().patch('ml-inexistente', { meliid: 'new-id' });
      expect(r).toBeNull();
    });

    it('atualiza e retorna o afiliado', async () => {
      const existing = {
        id: 1,
        mlUserId: 'ml-1',
        meliid: 'old-id',
        sessionCookies: null,
      } as unknown as MlAffiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([existing]) }) }),
            }),
            update: () => ({
              set: () => ({
                where: () => ({
                  returning: () => Promise.resolve([{ ...existing, meliid: 'new-id' }]),
                }),
              }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().patch('ml-1', { meliid: 'new-id' });
      expect(r).toBeDefined();
      expect(r!.meliid).toBe('new-id');
    });

    it('retorna existing sem update quando nenhum campo alterado', async () => {
      const existing = { id: 1, mlUserId: 'ml-1', meliid: 'some-id' } as unknown as MlAffiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([existing]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().patch('ml-1', {});
      expect(r).toEqual(existing);
    });
  });

  describe('refreshTokens', () => {
    it('atualiza tokens e retorna o afiliado', async () => {
      const updated = {
        id: 1,
        mlUserId: 'ml-1',
        accessToken: 'new-tok',
        refreshToken: 'new-rtok',
      } as unknown as MlAffiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            update: () => ({
              set: () => ({ where: () => ({ returning: () => Promise.resolve([updated]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().refreshTokens('ml-1', 'new-tok', 'new-rtok', 3600);
      expect(r).toEqual(updated);
    });

    it('retorna null quando nada retornado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            update: () => ({
              set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().refreshTokens('ml-inexistente', 'tok', 'rtok', 3600);
      expect(r).toBeNull();
    });
  });

  describe('touch', () => {
    it('atualiza lastUsedAt sem retorno', async () => {
      let capturedSet: unknown;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            update: () => ({
              set: (v: unknown) => {
                capturedSet = v;
                return { where: () => Promise.resolve(undefined) };
              },
            }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      await new MR().touch('ml-1');
      expect(capturedSet).toBeDefined();
      expect((capturedSet as any).lastUsedAt).toBeInstanceOf(Date);
    });
  });

  describe('delete', () => {
    it('retorna true quando deletado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().delete('ml-1');
      expect(r).toBe(true);
    });

    it('retorna false quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
          }),
      }));
      const { MlAffiliateRepository: MR } = await import('./mlAffiliates.repository.ts');
      const r = await new MR().delete('ml-inexistente');
      expect(r).toBe(false);
    });
  });
});
