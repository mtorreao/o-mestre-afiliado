/**
 * Testes do WhatsAppInstanceRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * select/insert/update/delete com `.from().where().limit()` encadeáveis
 * e retornam dados controlados — suficiente para testar a lógica CRUD
 * + upsert do repositório sem conexão externa.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { WhatsAppInstance } from './whatsAppInstances.repository.ts';

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

const { WhatsAppInstanceRepository } = await import('./whatsAppInstances.repository.ts');
const repo = new WhatsAppInstanceRepository();

describe('WhatsAppInstanceRepository', () => {
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
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findById(999);
      expect(r).toBeNull();
    });

    it('retorna a instância quando encontrado', async () => {
      const fakeRow = {
        id: 1,
        userId: 5,
        instanceId: 'inst-001',
        status: 'connected',
      } as WhatsAppInstance;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findById(1);
      expect(r).toEqual(fakeRow);
    });
  });

  describe('findByInstanceId', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findByInstanceId('inst-inexistente');
      expect(r).toBeNull();
    });

    it('retorna a instância quando encontrado', async () => {
      const fakeRow = { id: 2, instanceId: 'inst-002', status: 'disconnected' } as WhatsAppInstance;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findByInstanceId('inst-002');
      expect(r).toEqual(fakeRow);
    });
  });

  describe('findByInstanceName', () => {
    it('retorna null quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findByInstanceName('user-999');
      expect(r).toBeNull();
    });

    it('retorna a instância quando encontrado', async () => {
      const fakeRow = { id: 3, instanceId: 'user-5', userId: 5 } as WhatsAppInstance;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findByInstanceName('user-5');
      expect(r).toEqual(fakeRow);
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
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findByUserId(999);
      expect(r).toBeNull();
    });

    it('retorna a instância do usuário', async () => {
      const fakeRow = { id: 1, userId: 5, instanceId: 'inst-001' } as WhatsAppInstance;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => ({ where: () => ({ limit: () => Promise.resolve([fakeRow]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().findByUserId(5);
      expect(r).toEqual(fakeRow);
    });
  });

  describe('create', () => {
    it('insere e retorna a instância', async () => {
      const data = { userId: 5, instanceId: 'inst-new', status: 'pending' } as any;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            insert: () => ({
              values: () => ({ returning: () => Promise.resolve([{ id: 10, ...data }]) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().create(data);
      expect(r).toBeDefined();
      expect(r.id).toBe(10);
    });
  });

  describe('updateStatus', () => {
    it('atualiza e retorna a instância', async () => {
      const updatedRow = { id: 1, userId: 5, status: 'connected' } as WhatsAppInstance;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            update: () => ({
              set: () => ({ where: () => ({ returning: () => Promise.resolve([updatedRow]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().updateStatus(1, 'connected');
      expect(r).toEqual(updatedRow);
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
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().updateStatus(999, 'connected');
      expect(r).toBeNull();
    });
  });

  describe('updateRateLimit', () => {
    it('atualiza rate limit e retorna a instância', async () => {
      const updatedRow = {
        id: 1,
        rateLimitMaxMsgs: 100,
        rateLimitWindowSec: 60,
      } as WhatsAppInstance;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            update: () => ({
              set: () => ({ where: () => ({ returning: () => Promise.resolve([updatedRow]) }) }),
            }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().updateRateLimit(1, 100, 60);
      expect(r).toEqual(updatedRow);
    });
  });

  describe('deleteByInstanceId', () => {
    it('retorna true quando deletado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().deleteByInstanceId('inst-001');
      expect(r).toBe(true);
    });

    it('retorna false quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().deleteByInstanceId('inst-inexistente');
      expect(r).toBe(false);
    });
  });

  describe('deleteByUserId', () => {
    it('retorna true quando deletado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().deleteByUserId(5);
      expect(r).toBe(true);
    });

    it('retorna false quando não encontrado', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            delete: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
          }),
      }));
      const { WhatsAppInstanceRepository: WR } = await import('./whatsAppInstances.repository.ts');
      const r = await new WR().deleteByUserId(999);
      expect(r).toBe(false);
    });
  });
});
