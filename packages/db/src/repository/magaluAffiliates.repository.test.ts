import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { MagaluAffiliate, MagaluAffiliateUpsertData } from './magaluAffiliates.repository.ts';

function fakeSelect(result: unknown[]) {
  const chain = {
    from: () => ({
      where: () => ({ limit: () => Promise.resolve(result) }),
      orderBy: () => Promise.resolve(result),
    }),
  };
  return () => chain;
}

function fakeInsert(result: unknown[]) {
  return () => ({ values: () => ({ returning: () => Promise.resolve(result) }) });
}

function fakeUpdate(ret: unknown[]) {
  return () => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve(ret) }) }) });
}

function fakeDelete(ret: unknown[]) {
  return () => ({ where: () => ({ returning: () => Promise.resolve(ret) }) });
}

const emptyDb = {
  select: fakeSelect([]),
  insert: fakeInsert([]),
  update: fakeUpdate([]),
  delete: fakeDelete([]),
};

mock.module('../db.ts', () => ({ getDb: () => emptyDb }));

const { MagaluAffiliateRepository } = await import('./magaluAffiliates.repository.ts');
const repo = new MagaluAffiliateRepository();

describe('MagaluAffiliateRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({ getDb: () => emptyDb }));
  });

  it('findById null quando não encontrado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([]) }) }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    expect(await new R().findById(1)).toBeNull();
  });

  it('findById retorna row', async () => {
    const row = {
      id: 1,
      userId: 99,
      nickname: 'Matheus - Magalu',
      storeSlug: 'magazinetorre',
      active: true,
      connectedAt: new Date(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as MagaluAffiliate;
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([row]) }) }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    expect(await new R().findById(1)).toEqual(row);
  });

  it('findByUserId null quando não encontrado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([]) }) }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    expect(await new R().findByUserId(99)).toBeNull();
  });

  it('findByUserId retorna row', async () => {
    const row = {
      id: 1,
      userId: 99,
      nickname: null,
      storeSlug: 'lojadomateus',
      active: true,
      connectedAt: new Date(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as MagaluAffiliate;
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([row]) }) }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    expect(await new R().findByUserId(99)).toEqual(row);
  });

  it('findAll retorna lista vazia', async () => {
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    expect(await new R().findAll()).toEqual([]);
  });

  it('findAll mapeia para summary', async () => {
    const row = {
      id: 1,
      userId: 99,
      nickname: 'Matheus',
      storeSlug: 'magazinetorre',
      active: true,
      connectedAt: new Date(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as MagaluAffiliate;
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([row]) }) }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    const rows = await new R().findAll();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      id: 1,
      userId: 99,
      nickname: 'Matheus',
      storeSlug: 'magazinetorre',
      active: true,
      connectedAt: row.connectedAt,
      lastUsedAt: row.lastUsedAt,
    });
  });

  it('touch chama update', async () => {
    let touched = false;
    mock.module('../db.ts', () => ({
      getDb: () => ({
        ...emptyDb,
        update: () => ({
          set: () => {
            touched = true;
            return { where: () => Promise.resolve([]) };
          },
        }),
      }),
    }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    await new R().touch(1);
    expect(touched).toBe(true);
  });

  it('delete retorna false quando não encontrado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, delete: fakeDelete([]) }) }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    expect(await new R().delete(1)).toBe(false);
  });

  it('delete retorna true', async () => {
    mock.module('../db.ts', () => ({
      getDb: () => ({ ...emptyDb, delete: fakeDelete([{ id: 1 }]) }),
    }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    expect(await new R().delete(1)).toBe(true);
  });

  it('upsert — existente atualiza', async () => {
    const existing = {
      id: 1,
      userId: 99,
      nickname: 'Antigo',
      storeSlug: 'slug-antigo',
    } as unknown as MagaluAffiliate;
    let updated = false;
    mock.module('../db.ts', () => ({
      getDb: () => ({
        ...emptyDb,
        select: fakeSelect([existing]),
        update: () => ({
          set: () => {
            updated = true;
            return { where: () => ({ returning: () => Promise.resolve([existing]) }) };
          },
        }),
      }),
    }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    const r = await new R().upsert(99, { storeSlug: 'slug-novo' });
    expect(updated).toBe(true);
    expect(r).toBeDefined();
  });

  it('upsert — existente sem campos retorna o próprio registro', async () => {
    const existing = {
      id: 1,
      userId: 99,
      storeSlug: 'slug-antigo',
    } as unknown as MagaluAffiliate;
    mock.module('../db.ts', () => ({
      getDb: () => ({ ...emptyDb, select: fakeSelect([existing]) }),
    }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    const r = await new R().upsert(99, {} as unknown as MagaluAffiliateUpsertData);
    expect(r).toEqual(existing);
  });

  it('upsert — novo insere com defaults', async () => {
    let inserted: Record<string, unknown> = {};
    mock.module('../db.ts', () => ({
      getDb: () => ({
        ...emptyDb,
        select: fakeSelect([]),
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            inserted = v;
            return { returning: () => Promise.resolve([{ id: 1, userId: 99, ...v }]) };
          },
        }),
      }),
    }));
    const { MagaluAffiliateRepository: R } = await import('./magaluAffiliates.repository.ts');
    await new R().upsert(99, { nickname: 'Matheus', storeSlug: 'magazinetorre' });
    expect(inserted).toEqual({
      userId: 99,
      nickname: 'Matheus',
      storeSlug: 'magazinetorre',
      active: true,
    });
  });
});
