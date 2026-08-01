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
  it('aceita apenas quando o banco marca admin e o email está em ADMIN_EMAILS', async () => {
    const user = await getSuperAdminUser(
      fakeJwt({ userId: 1, userEmail: 'forged@example.com', isAdmin: false }),
      makeHeaders('Bearer tok'),
      'other@example.com, admin@example.com',
      async () => ({ email: 'ADMIN@EXAMPLE.COM', isAdmin: true }),
    );

    expect(user).toEqual({
      userId: 1,
      userEmail: 'ADMIN@EXAMPLE.COM',
      isAdmin: true,
    });
  });

  it('rejeita is_admin=true quando o email não está em ADMIN_EMAILS', async () => {
    expect(
      await getSuperAdminUser(
        fakeJwt({ userId: 1, userEmail: 'mtorreao1@gmail.com', isAdmin: true }),
        makeHeaders('Bearer tok'),
        'admin@omestreafiliado.com.br',
        async () => ({ email: 'mtorreao1@gmail.com', isAdmin: true }),
      ),
    ).toBeNull();
  });

  it('rejeita email permitido quando is_admin=false', async () => {
    expect(
      await getSuperAdminUser(
        fakeJwt({ userId: 1, userEmail: 'admin@example.com', isAdmin: false }),
        makeHeaders('Bearer tok'),
        'admin@example.com',
        async () => ({ email: 'admin@example.com', isAdmin: false }),
      ),
    ).toBeNull();
  });

  it('rejeita quando o usuário não existe mais no banco', async () => {
    expect(
      await getSuperAdminUser(
        fakeJwt({ userId: 1, userEmail: 'admin@example.com', isAdmin: true }),
        makeHeaders('Bearer tok'),
        'admin@example.com',
        async () => null,
      ),
    ).toBeNull();
  });

  it('rejeita quando ADMIN_EMAILS está vazio', async () => {
    expect(
      await getSuperAdminUser(
        fakeJwt({ userId: 1, userEmail: 'admin@example.com', isAdmin: true }),
        makeHeaders('Bearer tok'),
        '',
        async () => ({ email: 'admin@example.com', isAdmin: true }),
      ),
    ).toBeNull();
  });
});
