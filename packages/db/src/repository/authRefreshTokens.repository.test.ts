/**
 * Testes do AuthRefreshTokenRepository com mock de getDb (sem PostgreSQL real).
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { AuthRefreshToken } from './authRefreshTokens.repository.ts';

function fakeDb(over: any = {}) {
  return {
    select:
      over.select ??
      (() => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
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

await mock.module('../db.ts', () => ({
  getDb: () => fakeDb(),
}));

const { AuthRefreshTokenRepository } = await import('./authRefreshTokens.repository.ts');
const repo = new AuthRefreshTokenRepository();

const row: AuthRefreshToken = {
  id: 1,
  userId: 1,
  tokenHash: 'hash-a',
  familyId: 'fam-1',
  revokedAt: null,
  expiresAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthRefreshTokenRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({ getDb: () => fakeDb() }));
  });

  it('create insere e retorna o registro', async () => {
    const r = await repo.create({
      userId: 1,
      tokenHash: 'h',
      familyId: 'f',
      expiresAt: new Date(),
    });
    expect(r).toBeDefined();
    expect(r.id).toBe(1);
  });

  it('findActiveByHash retorna a linha quando existe', async () => {
    mock.module('../db.ts', () => ({
      getDb: () =>
        fakeDb({
          select: () => ({
            from: () => ({ where: () => ({ limit: () => Promise.resolve([row]) }) }),
          }),
        }),
    }));
    const r = await repo.findActiveByHash('a');
    expect(r?.id).toBe(1);
    expect(r?.tokenHash).toBe('hash-a');
  });

  it('findActiveByHash retorna null quando não há linha ativa', async () => {
    const r = await repo.findActiveByHash('missing');
    expect(r).toBeNull();
  });

  it('findByHashIncludingRevoked retorna mesmo registro revogado', async () => {
    const revoked = { ...row, revokedAt: new Date() };
    mock.module('../db.ts', () => ({
      getDb: () =>
        fakeDb({
          select: () => ({
            from: () => ({ where: () => ({ limit: () => Promise.resolve([revoked]) }) }),
          }),
        }),
    }));
    const r = await repo.findByHashIncludingRevoked('a');
    expect(r?.revokedAt).toBeInstanceOf(Date);
  });

  it('existsRevokedInFamily true quando há revogado', async () => {
    mock.module('../db.ts', () => ({
      getDb: () =>
        fakeDb({
          select: () => ({
            from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 1 }]) }) }),
          }),
        }),
    }));
    expect(await repo.existsRevokedInFamily('fam-1')).toBe(true);
  });

  it('existsRevokedInFamily false quando não há revogado', async () => {
    expect(await repo.existsRevokedInFamily('fam-x')).toBe(false);
  });

  it('revokeById chama update e resolve', async () => {
    await expect(repo.revokeById(1)).resolves.toBeUndefined();
  });

  it('revokeFamilyByFamilyId retorna nº de linhas', async () => {
    mock.module('../db.ts', () => ({
      getDb: () =>
        fakeDb({
          update: () => ({
            set: () => ({
              where: () => ({ returning: () => Promise.resolve([{ id: 1 }, { id: 2 }]) }),
            }),
          }),
        }),
    }));
    expect(await repo.revokeFamilyByFamilyId('fam-9')).toBe(2);
  });
});
