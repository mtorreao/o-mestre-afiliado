/**
 * Testes do UserRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * select/insert/update/delete com `.from().where().limit()` encadeáveis
 * e retornam dados controlados — suficiente para testar a lógica CRUD
 * do repositório sem conexão externa.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { User } from './users.repository.ts';

/** Cria um fake Db client com valores padrão que podem ser sobrescritos. */
function fakeDb(over: any = {}) {
  return {
    select:
      over.select ??
      (() => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })),
    insert:
      over.insert ??
      (() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) })),
    update: over.update ?? (() => ({ set: () => ({ where: () => Promise.resolve(undefined) }) })),
    delete:
      over.delete ?? (() => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) })),
  };
}

// Mock getDb ANTES de importar o repositório
await mock.module('../db.ts', () => ({
  getDb: () => fakeDb(),
}));

const { UserRepository } = await import('./users.repository.ts');
const repo = new UserRepository();

describe('UserRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({
      getDb: () => fakeDb(),
    }));
  });

  describe('findById', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findById(999);
      expect(r).toBeNull();
    });

    it('retorna o usuário quando encontrado', async () => {
      const fakeRow = { id: 1, name: 'João', email: 'joao@test.com' } as User;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findById(1);
      expect(r).toEqual(fakeRow);
    });
  });

  describe('findByEmail', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findByEmail('inexistente@test.com');
      expect(r).toBeNull();
    });

    it('retorna o usuário quando encontrado', async () => {
      const fakeRow = { id: 2, name: 'Maria', email: 'maria@test.com' } as User;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findByEmail('maria@test.com');
      expect(r).toEqual(fakeRow);
    });
  });

  describe('create', () => {
    it('insere e retorna o usuário', async () => {
      const data = { name: 'Novo', email: 'novo@test.com' } as any;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            insert: () => ({
              values: () => ({ returning: () => Promise.resolve([{ id: 10, ...data }]) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().create(data);
      expect(r).toBeDefined();
      expect(r.id).toBe(10);
      expect(r.email).toBe('novo@test.com');
    });
  });

  describe('findPublicById', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findPublicById(999);
      expect(r).toBeNull();
    });

    it('retorna dados públicos quando encontrado', async () => {
      const fakeRow = { id: 1, name: 'João', email: 'joao@test.com' } as User;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findPublicById(1);
      expect(r).toBeDefined();
      expect(r!.id).toBe(1);
      expect(r!.name).toBe('João');
    });
  });

  describe('findPublicByEmail', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findPublicByEmail('inexistente@test.com');
      expect(r).toBeNull();
    });

    it('retorna dados públicos quando encontrado', async () => {
      const fakeRow = { id: 2, name: 'Maria', email: 'maria@test.com' } as User;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { UserRepository: UR } = await import('./users.repository.ts');
      const r = await new UR().findPublicByEmail('maria@test.com');
      expect(r).toBeDefined();
      expect(r!.id).toBe(2);
      expect(r!.email).toBe('maria@test.com');
    });
  });
});
