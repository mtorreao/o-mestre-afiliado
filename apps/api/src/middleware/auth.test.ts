import { afterEach, describe, expect, it } from 'bun:test';
import { getAuthUser, getSuperAdminUser } from './auth.ts';

function makeHeaders(auth: string | null): Headers {
  const h = new Headers();
  if (auth !== null) h.set('authorization', auth);
  return h;
}

function fakeJwt(payload: Record<string, unknown> | null | false) {
  return { verify: async (_token?: string) => payload };
}

describe('getAuthUser', () => {
  it('retorna null sem header authorization', async () => {
    expect(await getAuthUser(fakeJwt({ userId: 1 }), makeHeaders(null))).toBeNull();
  });

  it('retorna null sem prefixo Bearer', async () => {
    expect(await getAuthUser(fakeJwt({ userId: 1 }), makeHeaders('Basic x'))).toBeNull();
  });

  it('retorna null quando verify retorna null', async () => {
    expect(await getAuthUser(fakeJwt(null), makeHeaders('Bearer tok'))).toBeNull();
  });

  it('retorna null quando verify retorna false', async () => {
    expect(await getAuthUser(fakeJwt(false), makeHeaders('Bearer tok'))).toBeNull();
  });

  it('retorna null sem userId number', async () => {
    expect(await getAuthUser(fakeJwt({ userId: 'abc' }), makeHeaders('Bearer tok'))).toBeNull();
  });

  it('userId 0 é válido', async () => {
    expect(await getAuthUser(fakeJwt({ userId: 0 }), makeHeaders('Bearer tok'))).toEqual({
      userId: 0,
      userEmail: '',
      isAdmin: false,
    });
  });

  it('extrai userId, userEmail e isAdmin do payload', async () => {
    expect(
      await getAuthUser(
        fakeJwt({ userId: 42, userEmail: 'u@e.com', isAdmin: true }),
        makeHeaders('Bearer tok'),
      ),
    ).toEqual({ userId: 42, userEmail: 'u@e.com', isAdmin: true });
  });

  it('userEmail default vazio', async () => {
    expect(await getAuthUser(fakeJwt({ userId: 7 }), makeHeaders('Bearer tok'))).toEqual({
      userId: 7,
      userEmail: '',
      isAdmin: false,
    });
  });

  it('userEmail String() mesmo se number', async () => {
    expect(
      await getAuthUser(fakeJwt({ userId: 9, userEmail: 123 }), makeHeaders('Bearer tok')),
    ).toEqual({ userId: 9, userEmail: '123', isAdmin: false });
  });

  it('isAdmin true apenas quando === true', async () => {
    const r1 = await getAuthUser(fakeJwt({ userId: 1, isAdmin: 'yes' }), makeHeaders('Bearer tok'));
    expect(r1!.isAdmin).toBe(false);
    const r2 = await getAuthUser(fakeJwt({ userId: 2, isAdmin: true }), makeHeaders('Bearer tok'));
    expect(r2!.isAdmin).toBe(true);
    const r3 = await getAuthUser(fakeJwt({ userId: 3 }), makeHeaders('Bearer tok'));
    expect(r3!.isAdmin).toBe(false);
  });
});

describe('getSuperAdminUser', () => {
  it('aceita quando o banco marca admin', async () => {
    const user = await getSuperAdminUser(
      fakeJwt({ userId: 1, userEmail: 'admin@example.com', isAdmin: false }),
      makeHeaders('Bearer tok'),
      async () => ({ isAdmin: true }),
    );

    expect(user).toEqual({
      userId: 1,
      userEmail: 'admin@example.com',
      isAdmin: true,
    });
  });

  it('rejeita quando is_admin=false no banco', async () => {
    expect(
      await getSuperAdminUser(
        fakeJwt({ userId: 1, userEmail: 'admin@example.com', isAdmin: true }),
        makeHeaders('Bearer tok'),
        async () => ({ isAdmin: false }),
      ),
    ).toBeNull();
  });

  it('rejeita quando o usuário não existe mais no banco', async () => {
    expect(
      await getSuperAdminUser(
        fakeJwt({ userId: 1, userEmail: 'admin@example.com', isAdmin: true }),
        makeHeaders('Bearer tok'),
        async () => null,
      ),
    ).toBeNull();
  });

  it('rejeita quando não autenticado', async () => {
    expect(
      await getSuperAdminUser(fakeJwt(null), makeHeaders('Bearer tok'), async () => ({
        isAdmin: true,
      })),
    ).toBeNull();
  });
});
