/**
 * Testes do AffiliatesRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * select/insert/update/delete com `.from().where().limit()` encadeáveis
 * e retornam dados controlados — suficiente para testar a lógica CRUD
 * do repositório sem conexão externa.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { Affiliate } from './affiliates.repository.ts';

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

const { AffiliatesRepository } = await import('./affiliates.repository.ts');
const repo = new AffiliatesRepository();

describe('AffiliatesRepository', () => {
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
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findById(999);
      expect(r).toBeNull();
    });

    it('retorna o affiliate quando encontrado', async () => {
      const fakeRow = { id: 1, name: 'Teste', evolutionInstanceId: 'inst-123' } as Affiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findById(1);
      expect(r).toEqual(fakeRow);
    });
  });

  describe('findByEvolutionInstanceId', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findByEvolutionInstanceId('inst-inexistente');
      expect(r).toBeNull();
    });

    it('retorna o affiliate quando encontrado', async () => {
      const fakeRow = { id: 2, name: 'Loja A', evolutionInstanceId: 'inst-abc' } as Affiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findByEvolutionInstanceId('inst-abc');
      expect(r).toEqual(fakeRow);
    });
  });

  describe('findNotificationConfig', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findNotificationConfig('inst-inexistente');
      expect(r).toBeNull();
    });

    it('retorna a config quando encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () =>
                    Promise.resolve([
                      { notificationChannel: 'email', notificationJid: 'admin@test.com' },
                    ]),
                }),
              }),
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findNotificationConfig('inst-abc');
      expect(r).toEqual({ channel: 'email', jid: 'admin@test.com' });
    });
  });

  describe('updateNotificationConfig', () => {
    it('retorna false quando affiliate não existe', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().updateNotificationConfig('inst-inexistente', { channel: 'sms' });
      expect(r).toBe(false);
    });

    it('atualiza e retorna true quando existe', async () => {
      let capturedSet: unknown;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({
                where: () => ({
                  limit: () => Promise.resolve([{ id: 1, evolutionInstanceId: 'inst-abc' }]),
                }),
              }),
            }),
            update: () => ({
              set: (v: unknown) => {
                capturedSet = v;
                return { where: () => Promise.resolve(undefined) };
              },
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().updateNotificationConfig('inst-abc', {
        channel: 'sms',
        jid: '1199999999',
      });
      expect(r).toBe(true);
      expect(capturedSet).toEqual({ notificationChannel: 'sms', notificationJid: '1199999999' });
    });
  });

  describe('deleteByEvolutionInstanceId', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().deleteByEvolutionInstanceId('inst-inexistente');
      expect(r).toBeNull();
    });

    it('deleta e retorna o affiliate quando encontrado', async () => {
      const fakeRow = { id: 1, name: 'Teste', evolutionInstanceId: 'inst-abc' } as Affiliate;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([fakeRow]) }) }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().deleteByEvolutionInstanceId('inst-abc');
      expect(r).toEqual(fakeRow);
    });
  });

  describe('findAll', () => {
    it('retorna lista vazia quando não há afiliados', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({ from: () => Promise.resolve([]) }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findAll();
      expect(r).toEqual([]);
    });

    it('retorna todos os afiliados', async () => {
      const fakeRows = [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ] as Affiliate[];
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({ from: () => Promise.resolve(fakeRows) }),
          }),
      }));
      const { AffiliatesRepository: AR } = await import('./affiliates.repository.ts');
      const r = await new AR().findAll();
      expect(r).toHaveLength(2);
      expect(r[0]!.id).toBe(1);
      expect(r[1]!.id).toBe(2);
    });
  });
});
