import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { AmazonAffiliate } from './amazonAffiliates.repository.ts';

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

const { AmazonAffiliateRepository } = await import('./amazonAffiliates.repository.ts');
const repo = new AmazonAffiliateRepository();

describe('AmazonAffiliateRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({ getDb: () => emptyDb }));
  });

  it('findById null quando não encontrado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([]) }) }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().findById(1)).toBeNull();
  });

  it('findById retorna row', async () => {
    const row = {
      id: 1,
      userId: 99,
      nickname: 'n',
      trackingIds: [],
      active: true,
      connectedAt: new Date(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AmazonAffiliate;
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([row]) }) }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().findById(1)).toEqual(row);
  });

  it('findByUserId null quando não encontrado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([]) }) }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().findByUserId(99)).toBeNull();
  });

  it('findAll retorna lista vazia', async () => {
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().findAll()).toEqual([]);
  });

  it('findAll com toSummary', async () => {
    const row = {
      id: 1,
      userId: 99,
      nickname: 'n',
      trackingIds: [{ tag: 'a-20', region: 'BR', active: true, isDefault: true, createdAt: '' }],
      active: true,
      connectedAt: new Date(),
      lastUsedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as AmazonAffiliate;
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([row]) }) }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    const rows = await new R().findAll();
    expect(rows).toHaveLength(1);
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
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    await new R().touch(1);
    expect(touched).toBe(true);
  });

  it('delete retorna false quando não encontrado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, delete: fakeDelete([]) }) }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().delete(1)).toBe(false);
  });

  it('delete retorna true', async () => {
    mock.module('../db.ts', () => ({
      getDb: () => ({ ...emptyDb, delete: fakeDelete([{ id: 1 }]) }),
    }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().delete(1)).toBe(true);
  });

  it('upsert — existente atualiza', async () => {
    const existing = {
      id: 1,
      userId: 99,
      nickname: 'old',
      trackingIds: [],
    } as unknown as AmazonAffiliate;
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
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    const r = await new R().upsert(99, { nickname: 'new', trackingIds: [] });
    expect(updated).toBe(true);
    expect(r).toBeDefined();
  });

  it('upsert — novo insere', async () => {
    let inserted = false;
    mock.module('../db.ts', () => ({
      getDb: () => ({
        ...emptyDb,
        select: fakeSelect([]),
        insert: () => ({
          values: () => {
            inserted = true;
            return { returning: () => Promise.resolve([{ id: 1, userId: 99 }]) };
          },
        }),
      }),
    }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    await new R().upsert(99, { nickname: 'new', trackingIds: [] });
    expect(inserted).toBe(true);
  });

  it('addTrackingId', async () => {
    mock.module('../db.ts', () => ({
      getDb: () => ({
        ...emptyDb,
        select: fakeSelect([{ id: 1, userId: 99, trackingIds: [] } as unknown as AmazonAffiliate]),
        update: () => ({
          set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
        }),
      }),
    }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    const r = await new R().addTrackingId(99, { tag: 'a-20' });
    expect(r).toBeDefined();
  });

  it('removeTrackingId', async () => {
    mock.module('../db.ts', () => ({
      getDb: () => ({
        ...emptyDb,
        select: fakeSelect([
          { id: 1, userId: 99, trackingIds: [{ tag: 'a-20' }] } as AmazonAffiliate,
        ]),
        update: () => ({
          set: () => ({ where: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
        }),
      }),
    }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().removeTrackingId(99, 'a-20')).toBeDefined();
  });

  it('getDefaultTrackingId null sem afiliado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([]) }) }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().getDefaultTrackingId(99)).toBeNull();
  });

  it('getActiveTrackingId null sem afiliado', async () => {
    mock.module('../db.ts', () => ({ getDb: () => ({ ...emptyDb, select: fakeSelect([]) }) }));
    const { AmazonAffiliateRepository: R } = await import('./amazonAffiliates.repository.ts');
    expect(await new R().getActiveTrackingId(99, 'a-20')).toBeNull();
  });
});
