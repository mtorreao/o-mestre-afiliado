import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mem = new Map<string, string>();
const storage: Storage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as unknown as Storage;

let S: typeof import('./auth-session.ts');

beforeEach(async () => {
  mem.clear();
  globalThis.localStorage = storage;
  S = await import('./auth-session.ts');
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const cut = () => Math.floor(Date.now() / 1000);
const jwtOf = (exp: number) =>
  'a.' + Buffer.from(JSON.stringify({ exp })).toString('base64').replace(/=+$/, '') + '.sig';

describe('auth-session', () => {
  it('set/get/clear session', () => {
    S.setSession('a', 'r');
    expect(S.getSession().accessToken).toBe('a');
    expect(S.getSession().refreshToken).toBe('r');
    expect(S.getSession().active).toBe(true);
    expect(S.getAccessToken()).toBe('a');
    S.clearSession();
    expect(S.getSession().active).toBe(false);
  });

  it('subscribeSession notifica e unsub funcional', () => {
    let n = 0;
    const un = S.subscribeSession(() => n++);
    S.setSession('a', 'r');
    S.clearSession();
    expect(n).toBe(2);
    un();
    S.setSession('b', 'r');
    expect(n).toBe(2);
  });

  it('refreshTokens chama /api/auth/refresh e salva novo par', async () => {
    S.setSession('old-a', 'old-r');
    let url = '';
    let body = '';
    globalThis.fetch = mock(async (input?: unknown, init?: RequestInit) => {
      url = String(input);
      body = String(init?.body ?? '');
      return ok({ success: true, token: 'new-a', refreshToken: 'new-r' });
    }) as never;
    const r = await S.refreshTokens();
    expect(r.accessToken).toBe('new-a');
    expect(S.getAccessToken()).toBe('new-a');
    expect(url).toBe('/api/auth/refresh');
    expect(JSON.parse(body).refreshToken).toBe('old-r');
  });

  it('refreshTokens lança sem refresh token', async () => {
    await expect(S.refreshTokens()).rejects.toThrow('Sem refresh token');
  });

  it('refreshTokens lança quando API falha', async () => {
    S.setSession('a', 'r');
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ success: false }), { status: 401 })) as never;
    await expect(S.refreshTokens()).rejects.toThrow();
  });

  it('refreshTokens single-flight: 2 chamadas concorrentes = 1 fetch', async () => {
    S.setSession('a', 'r');
    let count = 0;
    globalThis.fetch = (async () => {
      count++;
      return ok({ success: true, token: 'x', refreshToken: 'y' });
    }) as never;
    const [r1, r2] = await Promise.all([S.refreshTokens(), S.refreshTokens()]);
    expect(r1.accessToken).toBe('x');
    expect(r2.accessToken).toBe('x');
    expect(count).toBe(1);
  });

  it('proactivelyRefreshNow renova token perto de expirar', async () => {
    const token = jwtOf(cut() + 5);
    S.setSession(token, 'r');
    globalThis.fetch = (async () =>
      ok({ success: true, token: 'a2', refreshToken: 'r2' })) as never;
    expect(await S.proactivelyRefreshNow()).toBe(true);
    expect(S.getAccessToken()).toBe('a2');
  });

  it('proactivelyRefreshNow retorna false com token ok', async () => {
    const token = jwtOf(cut() + 3600);
    S.setSession(token, 'r');
    expect(await S.proactivelyRefreshNow()).toBe(false);
  });

  it('logoutSession limpa e chama POST /api/auth/logout', async () => {
    S.setSession('a', 'rt');
    let called = false;
    globalThis.fetch = (async (input?: unknown) => {
      called = String(input).includes('/api/auth/logout');
      return ok({ success: true });
    }) as never;
    await S.logoutSession();
    expect(S.getSession().active).toBe(false);
    expect(called).toBe(true);
  });

  it('logoutSession sem refresh nao chama fetch', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return ok({});
    }) as never;
    await S.logoutSession();
    expect(called).toBe(false);
  });
});
