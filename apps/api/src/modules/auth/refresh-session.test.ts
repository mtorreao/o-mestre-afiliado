/**
 * Testes unitários de refreshSession() com mocks de objeto injetados.
 * Não usa mock.module — roda sem conflito na suíte completa.
 */
import { describe, expect, it } from 'bun:test';
import { refreshSession, type RefreshSessionDeps } from './refresh-session.ts';
import type { RefreshTokenRowLike } from './refresh-session.ts';

function activeRow(over = {}): RefreshTokenRowLike {
  return {
    id: 5,
    userId: 7,
    familyId: 'fam-1',
    tokenHash: 'h',
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...over,
  };
}

function makeDeps(over: Partial<RefreshSessionDeps> = {}): RefreshSessionDeps {
  const row = activeRow();
  return {
    refreshTokenRepo: {
      findByHashIncludingRevoked: async () => row,
      revokeById: async () => undefined,
      revokeFamilyByFamilyId: async () => 1,
      create: async () => ({ id: 6 }),
    },
    userRepo: {
      findById: async () => ({ id: 7, email: 'u@x.com', isAdmin: true }),
    },
    jwtSign: async (p) => `jwt.${p.userId}.${p.exp}`,
    ...over,
  };
}

describe('refreshSession', () => {
  it('sem refreshToken -> 400', async () => {
    const r = await refreshSession(undefined, makeDeps());
    expect(r.status).toBe(400);
  });

  it('token desconhecido (null) -> 401', async () => {
    const deps = makeDeps({
      refreshTokenRepo: {
        ...makeDeps().refreshTokenRepo,
        findByHashIncludingRevoked: async () => null,
      },
    });
    const r = await refreshSession('abc', deps);
    expect(r.status).toBe(401);
  });

  it('token expirado -> 401', async () => {
    const deps = makeDeps({
      refreshTokenRepo: {
        ...makeDeps().refreshTokenRepo,
        findByHashIncludingRevoked: async () =>
          activeRow({ expiresAt: new Date(Date.now() - 1000) }),
      },
    });
    const r = await refreshSession('abc', deps);
    expect(r.status).toBe(401);
  });

  it('replay (revogado no prazo) -> revoga familia + 401', async () => {
    let revokedFamily = false;
    const deps = makeDeps({
      refreshTokenRepo: {
        ...makeDeps().refreshTokenRepo,
        findByHashIncludingRevoked: async () =>
          activeRow({ revokedAt: new Date(Date.now() - 1000) }),
        revokeFamilyByFamilyId: async () => {
          revokedFamily = true;
          return 3;
        },
      },
    });
    const r = await refreshSession('abc', deps);
    expect(r.status).toBe(401);
    expect(revokedFamily).toBe(true);
  });

  it('token válido: revoga atual, emite novo access+refresh, mantém família', async () => {
    const calls = { revokeId: 0, createCount: 0, createdFamily: '' };
    const deps = makeDeps({
      refreshTokenRepo: {
        ...makeDeps().refreshTokenRepo,
        findByHashIncludingRevoked: async () => activeRow(),
        revokeById: async (id) => {
          calls.revokeId = id;
        },
        create: async (row) => {
          calls.createCount++;
          calls.createdFamily = row.familyId;
          return { id: 6 };
        },
      },
    });
    const r = await refreshSession('abc', deps);
    expect(r.status).toBe(200);
    if (r.ok) {
      expect(r.token).toContain('jwt.7');
      expect(r.refreshToken.length).toBe(64);
    }
    expect(calls.revokeId).toBe(5);
    expect(calls.createCount).toBe(1);
    expect(calls.createdFamily).toBe('fam-1');
  });

  it('token válido mas usuário sumiu -> 401', async () => {
    const deps = makeDeps({
      userRepo: { findById: async () => null },
    });
    const r = await refreshSession('abc', deps);
    expect(r.status).toBe(401);
  });
});
