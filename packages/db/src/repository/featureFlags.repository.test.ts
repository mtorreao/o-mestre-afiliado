import { afterEach, describe, expect, it, mock } from 'bun:test';

const emptyDb = { select: () => ({ from: () => Promise.resolve([]) }) };
mock.module('../db.ts', () => ({ getDb: () => emptyDb }));

const { FeatureFlagRepository } = await import('./featureFlags.repository.ts');

describe('FeatureFlagRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({ getDb: () => emptyDb }));
  });

  it('findAll retorna array vazio', async () => {
    expect(await new FeatureFlagRepository().findAll()).toEqual([]);
  });

  it('findAll retorna rows', async () => {
    const rows = [{ key: 'a', enabled: true, updatedBy: null, updatedAt: new Date() }];
    mock.module('../db.ts', () => ({
      getDb: () => ({ select: () => ({ from: () => Promise.resolve(rows) }) }),
    }));
    const { FeatureFlagRepository: R } = await import('./featureFlags.repository.ts');
    expect(await new R().findAll()).toEqual(rows);
  });

  it('findByKey null quando não encontrado', async () => {
    mock.module('../db.ts', () => ({
      getDb: () => ({
        select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
      }),
    }));
    const { FeatureFlagRepository: R } = await import('./featureFlags.repository.ts');
    expect(await new R().findByKey('x')).toBeNull();
  });

  it('findByKey retorna row quando encontrado', async () => {
    const row = {
      key: 'flag1',
      enabled: true,
      updatedBy: 'admin',
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    mock.module('../db.ts', () => ({
      getDb: () => ({
        select: () => ({
          from: () => ({ where: () => ({ limit: () => Promise.resolve([row]) }) }),
        }),
      }),
    }));
    const { FeatureFlagRepository: R } = await import('./featureFlags.repository.ts');
    expect(await new R().findByKey('flag1')).toEqual(row);
  });

  it('upsert retorna row', async () => {
    const result = [{ key: 'f', enabled: true }];
    mock.module('../db.ts', () => ({
      getDb: () => ({
        insert: () => ({
          values: () => ({
            onConflictDoUpdate: () => ({ returning: () => Promise.resolve(result) }),
          }),
        }),
      }),
    }));
    const { FeatureFlagRepository: R } = await import('./featureFlags.repository.ts');
    const r = await new R().upsert('f', true, 'admin');
    expect(r.key).toBe('f');
    expect(r.enabled).toBe(true);
  });
});
