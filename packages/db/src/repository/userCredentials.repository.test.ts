/**
 * Testes do UserCredentialsRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * select/insert/update/delete com `.from().where().limit()` encadeáveis
 * e retornam dados controlados — suficiente para testar a lógica CRUD
 * + upsert do repositório sem conexão externa.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { UserCredentials } from './userCredentials.repository.ts';

/** Cria um fake Db client com valores padrão que podem ser sobrescritos. */
function fakeDb(over: any = {}) {
  return {
    select:
      over.select ??
      (() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })),
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

// Mock getDb ANTES de importar o repositório
await mock.module('../db.ts', () => ({
  getDb: () => fakeDb(),
}));

const { UserCredentialsRepository } = await import('./userCredentials.repository.ts');
const repo = new UserCredentialsRepository();

describe('UserCredentialsRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({
      getDb: () => fakeDb(),
    }));
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
      const { UserCredentialsRepository: UCR } = await import('./userCredentials.repository.ts');
      const r = await new UCR().findByUserId(999);
      expect(r).toBeNull();
    });

    it('retorna as credenciais quando encontrado', async () => {
      const fakeRow = {
        id: 1,
        userId: 5,
        shopeeAppId: 'shop-id',
        shopeeAppSecret: 'secret',
      } as UserCredentials;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { UserCredentialsRepository: UCR } = await import('./userCredentials.repository.ts');
      const r = await new UCR().findByUserId(5);
      expect(r).toEqual(fakeRow);
    });
  });

  describe('upsert', () => {
    it('cria novas credenciais quando não existem', async () => {
      const insertedRow = {
        id: 1,
        userId: 10,
        shopeeAppId: 'shop-id',
        shopeeAppSecret: 'secret',
      } as UserCredentials;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            // retorna vazio na busca (não existe) → insert
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
            insert: () => ({ values: () => ({ returning: () => Promise.resolve([insertedRow]) }) }),
          }),
      }));
      const { UserCredentialsRepository: UCR } = await import('./userCredentials.repository.ts');
      const r = await new UCR().upsert(10, { shopeeAppId: 'shop-id', shopeeAppSecret: 'secret' });
      expect(r).toEqual(insertedRow);
    });

    it('atualiza credenciais existentes', async () => {
      const existingRow = {
        id: 1,
        userId: 10,
        shopeeAppId: 'old-id',
        shopeeAppSecret: 'old-secret',
      } as UserCredentials;
      const updatedRow = {
        id: 1,
        userId: 10,
        shopeeAppId: 'new-id',
        shopeeAppSecret: 'new-secret',
      } as UserCredentials;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            // retorna existente na busca → update
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([existingRow]) }) }),
            }),
            update: () => ({
              set: () => ({ where: () => ({ returning: () => Promise.resolve([updatedRow]) }) }),
            }),
          }),
      }));
      const { UserCredentialsRepository: UCR } = await import('./userCredentials.repository.ts');
      const r = await new UCR().upsert(10, {
        shopeeAppId: 'new-id',
        shopeeAppSecret: 'new-secret',
      });
      expect(r).toEqual(updatedRow);
    });

    it('retorna existente quando nenhum campo para atualizar', async () => {
      const existingRow = {
        id: 1,
        userId: 10,
        shopeeAppId: 'shop-id',
        shopeeAppSecret: 'secret',
      } as UserCredentials;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([existingRow]) }) }),
            }),
          }),
      }));
      const { UserCredentialsRepository: UCR } = await import('./userCredentials.repository.ts');
      const r = await new UCR().upsert(10, {});
      expect(r).toEqual(existingRow);
    });
  });
});
