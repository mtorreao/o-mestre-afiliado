/**
 * Testes do auth.routes.ts — Item #6 (JWT exp 7 dias).
 *
 * Garante que tokens emitidos por /api/auth/login e /api/auth/register
 * carregam o campo `exp` (~7 dias a partir da emissão).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

process.env.JWT_SECRET = 'test-secret-for-jwt-exp-validation';

await mock.module('../../../middleware/auth-rate-limit-pure.ts', () => ({
  getClientIp: () => '127.0.0.1',
  IpRateLimiter: class {
    check = mock(() => {});
    prune = mock(() => 0);
  },
  LOGIN_MAX_REQUESTS: 5,
  LOGIN_WINDOW_MS: 60000,
  REGISTER_MAX_REQUESTS: 3,
  REGISTER_WINDOW_MS: 3600000,
  RateLimitError: class extends Error {},
  isRateLimitEnabled: () => false,
}));

const findByEmailMock = mock(
  (): Promise<null | {
    id: number;
    email: string;
    name: string;
    isAdmin: boolean;
    passwordHash: string;
  }> => Promise.resolve(null),
);

const upsertMock = mock(() => Promise.resolve({}));

const createMock = mock(() =>
  Promise.resolve({
    id: 1,
    email: 'user@x.com',
    name: 'User',
    isAdmin: false,
  }),
);

const isEmailAdminAllowed = mock(() => false);

await mock.module('@omestre/db', () => ({
  UserRepository: class {
    findByEmail = findByEmailMock;
    create = createMock;
    promoteToAdmin = mock(() => Promise.resolve(null));
  },
  UserCredentialsRepository: class {
    upsert = upsertMock;
  },
  AuthRefreshTokenRepository: class {
    create = mock(() =>
      Promise.resolve({ id: 1, tokenHash: 'h', familyId: 'f', expiresAt: new Date() }),
    );
    findByHashIncludingRevoked = mock(() => Promise.resolve(null));
    revokeById = mock(() => Promise.resolve());
    revokeFamilyByFamilyId = mock(() => Promise.resolve(1));
  },
  isEmailAdminAllowed: () => false,
}));

const { Elysia } = await import('elysia');
const { authRoutes } = await import('../auth.routes.ts');
const app = new Elysia().use(authRoutes);

async function call(method: string, path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT structure');
  const payloadB64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8'));
}

beforeEach(() => {
  findByEmailMock.mockClear();
  createMock.mockClear();
  upsertMock.mockClear();
});

describe('Item #6 — JWT exp 1 hora + refresh token', () => {
  it('POST /api/auth/login emite token com exp', async () => {
    findByEmailMock.mockImplementationOnce(() =>
      Promise.resolve({
        id: 1,
        email: 'user@x.com',
        name: 'User',
        isAdmin: false,
        passwordHash: 'hash',
      }),
    );

    // Mock do Bun.password.verify
    const originalVerify = Bun.password.verify;
    Bun.password.verify = mock(() => Promise.resolve(true)) as never;

    try {
      const res = await call('POST', '/api/auth/login', {
        email: 'user@x.com',
        password: 'senha',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; token: string; refreshToken?: string };
      expect(body.token).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();

      const payload = decodeJwtPayload(body.token);
      expect(typeof payload.exp).toBe('number');
      const oneHourFromNow = Math.floor(Date.now() / 1000) + 60 * 60;
      const diff = Number(payload.exp) - oneHourFromNow;
      expect(Math.abs(diff)).toBeLessThanOrEqual(5);
    } finally {
      Bun.password.verify = originalVerify;
    }
  });

  it('POST /api/auth/register emite token com exp', async () => {
    const originalHash = Bun.password.hash;
    Bun.password.hash = mock(() => Promise.resolve('hash')) as never;

    try {
      const res = await call('POST', '/api/auth/register', {
        email: 'new@x.com',
        name: 'New',
        password: 'senha123',
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; token: string; refreshToken?: string };
      expect(body.refreshToken).toBeTruthy();
      const payload = decodeJwtPayload(body.token);
      expect(typeof payload.exp).toBe('number');
      const oneHourFromNow = Math.floor(Date.now() / 1000) + 60 * 60;
      const diff = Number(payload.exp) - oneHourFromNow;
      expect(Math.abs(diff)).toBeLessThanOrEqual(5);
    } finally {
      Bun.password.hash = originalHash;
    }
  });

  it('exp está em segundos Unix (não ms)', async () => {
    findByEmailMock.mockImplementationOnce(() =>
      Promise.resolve({
        id: 2,
        email: 'a@b.com',
        name: 'A',
        isAdmin: false,
        passwordHash: 'hash',
      }),
    );

    const originalVerify = Bun.password.verify;
    Bun.password.verify = mock(() => Promise.resolve(true)) as never;

    try {
      const res = await call('POST', '/api/auth/login', {
        email: 'a@b.com',
        password: 'senha',
      });
      const body = (await res.json()) as { token: string };
      const payload = decodeJwtPayload(body.token);
      // ~10 dígitos para Unix timestamp em segundos (atualmente 1.7e9)
      expect(String(payload.exp).length).toBeLessThanOrEqual(11);
    } finally {
      Bun.password.verify = originalVerify;
    }
  });
});
