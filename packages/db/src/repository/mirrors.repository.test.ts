/**
 * Testes do MirrorRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * select/insert/update/delete com `.from().where().limit()` encadeáveis
 * e retornam dados controlados — suficiente para testar a lógica de
 * paginação, filtros e CRUD do repositório sem conexão externa.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Mirror, MirrorUpdateData } from './mirrors.repository.ts';
import type { NormalizedPagination } from './mirror-pagination.ts';

type QueryFn = (...args: unknown[]) => { from: (t: unknown) => { where: (w?: unknown) => any } };

function fakeDb(over: any = {}) {
  return {
    select:
      over.select ??
      (() => ({
        from: () => ({
          where: () => Promise.resolve([]),
          orderBy: () => Promise.resolve([]),
          limit: () => Promise.resolve([]),
          offset: () => Promise.resolve([]),
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

// Mock getDb ANTES de importar o MirrorRepository
await mock.module('../db.ts', () => ({
  getDb: () => fakeDb(),
}));

const { MirrorRepository } = await import('./mirrors.repository.ts');
const repo = new MirrorRepository();

describe('MirrorRepository', () => {
  afterEach(() => {
    // restore defaults after each test that overrides getDb
    mock.module('../db.ts', () => ({
      getDb: () => fakeDb(),
    }));
  });

  describe('create', () => {
    it('insere e retorna o mirror', async () => {
      const data = { name: 'teste', status: 'active' } as any;
      const r = await repo.create(data);
      expect(r).toBeDefined();
      expect(r.id).toBe(1);
    });
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
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      const r = await new MR().findById(999);
      expect(r).toBeNull();
    });

    it('retorna o mirror quando encontrado', async () => {
      const fakeRow = { id: 1, name: 'achado', status: 'active' } as Mirror;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      const r = await new MR().findById(1);
      expect(r).toEqual(fakeRow);
    });
  });

  describe('list', () => {
    it('usa defaults de paginação quando sem filtros', async () => {
      const fakeRows = [] as Mirror[];
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: (fields?: unknown) => {
              if (fields && typeof fields === 'object' && 'total' in (fields as any)) {
                // count query
                return { from: () => ({ where: () => Promise.resolve([{ total: 0 }]) }) };
              }
              return {
                from: () => ({
                  where: () => ({
                    orderBy: () => ({ limit: () => ({ offset: () => Promise.resolve(fakeRows) }) }),
                  }),
                }),
              };
            },
          }),
      }));
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      const r = await new MR().list({});
      expect(r.page).toBe(1);
      expect(r.pageSize).toBe(25);
      expect(r.total).toBe(0);
      expect(r.totalPages).toBe(1);
    });

    it('aplica filtro de status', async () => {
      let appliedWhere: unknown;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: (fields?: unknown) => {
              if (fields && typeof fields === 'object' && 'total' in (fields as any)) {
                return {
                  from: () => ({
                    where: (w?: unknown) => {
                      appliedWhere = w;
                      return Promise.resolve([{ total: 5 }]);
                    },
                  }),
                };
              }
              return {
                from: () => ({
                  where: (w?: unknown) => ({
                    orderBy: () => ({
                      limit: () => ({ offset: () => Promise.resolve([] as Mirror[]) }),
                    }),
                  }),
                }),
              };
            },
          }),
      }));
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      await new MR().list({ status: 'active' });
      expect(appliedWhere).toBeDefined();
    });
  });

  describe('update', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          } as any),
      }));
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      const r = await new MR().update(999, { name: 'x' });
      expect(r).toBeNull();
    });
  });

  describe('patchStatus', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          } as any),
      }));
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      const r = await new MR().patchStatus(999, 'inactive');
      expect(r).toBeNull();
    });
  });

  describe('delete', () => {
    it('retorna false quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
          }),
      }));
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      const r = await new MR().delete(999);
      expect(r).toBe(false);
    });

    it('retorna true quando deletado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
          }),
      }));
      const { MirrorRepository: MR } = await import('./mirrors.repository.ts');
      const r = await new MR().delete(1);
      expect(r).toBe(true);
    });
  });
});
