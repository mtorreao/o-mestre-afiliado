/**
 * Autenticação single-user — Basic Auth com senha hasheada (argon2id via Bun).
 *
 * Design:
 *  - Um único usuário (admin). Não há cadastro, não há recuperação.
 *  - Senha nunca viaja em texto puro: só o hash argon2id fica no .env.
 *  - O fluxo de login é o Basic Auth padrão: o browser manda
 *    `Authorization: Basic base64...s)`.
 *  - Sessão: emitimos um token de sessão (random 32 bytes hex) após login
 *    bem-sucedido; o client envia em `Authorization: Bearer <token>`.
 *    Isso evita re-hashear argon2id a cada request (argon2id é caro por design).
 *  - Persistência da sessão: Postgres (fonte da verdade) + Redis (cache 5min).
 *    Sobrevive a restart do admin-api.
 *
 * Sem dependência de lib: usa `Bun.password` (argon2id nativo do runtime).
 */
import type { Context, MiddlewareHandler } from 'hono';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SessionRepository, type SessionRecord } from './db/sessionRepository.ts';
import { getCachedSession, invalidateCachedSession, setCachedSession } from './auth-cache.ts';

// ─── Hash ───────────────────────────────────────────────────────────────

/** Gera hash argon2id (formato Bun). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

/** Verifica senha contra hash argon2id (constante-tempo). */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// ─── Sessões (Postgres + cache Redis) ───────────────────────────────────

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/**
 * Dependências injetáveis. Default = SessionRepository real + Redis real.
 * Em testes, injetar fakes via `setAuthDepsForTesting()`.
 */
interface AuthDeps {
  sessionRepo: SessionRepository;
  cache: {
    get: (id: string) => Promise<{ id: string; email: string; expiresAt: string } | null>;
    set: (s: { id: string; email: string; expiresAt: string }) => Promise<void>;
    invalidate: (id: string) => Promise<void>;
  };
}

let deps: AuthDeps = {
  sessionRepo: new SessionRepository(),
  cache: {
    get: getCachedSession,
    set: setCachedSession,
    invalidate: invalidateCachedSession,
  },
};

/** Injeta dependências. Apenas para testes. */
export function setAuthDepsForTesting(overrides: Partial<AuthDeps>): void {
  deps = { ...deps, ...overrides };
}

/** Reseta para defaults. Apenas para testes. */
export function resetAuthDepsForTesting(): void {
  deps = {
    sessionRepo: new SessionRepository(),
    cache: {
      get: getCachedSession,
      set: setCachedSession,
      invalidate: invalidateCachedSession,
    },
  };
}

export interface CreateSessionOptions {
  ipAddress?: string | null;
  userAgent?: string | null;
  email?: string;
}

/** Cria sessão, persiste no Postgres e popula cache Redis. */
export async function createSession(options: CreateSessionOptions = {}): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  // csrfToken aleatório por sessão — não validado em rotas atuais, mas o
  // schema exige. Reservado para uso futuro (CSRF em mutações sensíveis).
  const csrfToken = randomBytes(16).toString('hex');
  // encryptedPayload guarda o email e metadados mínimos. Não ciframos — o
  // token já é o segredo (32 bytes hex = 256 bits de entropia). Quem tiver
  // acesso ao banco já tem acesso ao `token` via DB leak da mesma forma.
  const encryptedPayload = JSON.stringify({
    email: options.email ?? 'admin',
    createdAt: now.toISOString(),
  });

  await deps.sessionRepo.create({
    id: token,
    email: options.email ?? 'admin',
    csrfToken,
    encryptedPayload,
    ipAddress: options.ipAddress,
    userAgent: options.userAgent,
    expiresAt,
  });

  await deps.cache.set({
    id: token,
    email: options.email ?? 'admin',
    expiresAt: expiresAt.toISOString(),
  });
  return token;
}

/** Valida token: checa cache primeiro, depois Postgres. Re-popula cache. */
export async function isValidSession(token: string): Promise<boolean> {
  // 1. Cache (rápido)
  const cached = await deps.cache.get(token);
  if (cached) return true;

  // 2. Postgres (fonte da verdade)
  const row = await deps.sessionRepo.findValidById(token);
  if (!row) return false;

  // 3. Re-popula cache
  await deps.cache.set({
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
  });
  return true;
}

/** Remove sessão do Postgres + invalida cache. Idempotente. */
export async function destroySession(token: string): Promise<void> {
  await deps.sessionRepo.deleteById(token);
  await deps.cache.invalidate(token);
}

/** Remove sessões expiradas. Retorna número de linhas removidas. */
export async function purgeExpiredSessions(): Promise<number> {
  return deps.sessionRepo.deleteExpired();
}

/** Helper para testes: lê registro cru do Postgres. */
export async function getSessionRecord(token: string): Promise<SessionRecord | null> {
  return deps.sessionRepo.findValidById(token);
}

// ─── Helpers de comparação constante-tempo ───────────────────────────────

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ─── Middlewares Hono ────────────────────────────────────────────────────

export interface AuthEnv {
  Variables: {
    authUser?: string;
  };
}

/**
 * Middleware de sessão: aceita `Authorization: Bearer <token>` e valida.
 * Usado nas rotas /admin/*.
 */
export const sessionAuth = (): MiddlewareHandler<AuthEnv> => {
  return async (c: Context<AuthEnv>, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }
    const token = header.slice('Bearer '.length).trim();
    if (!(await isValidSession(token))) {
      return c.json({ success: false, error: 'unauthorized' }, 401);
    }
    c.set('authUser', 'admin');
    await next();
  };
};

/** Extrai Basic Auth (user:pass) do header. */
export function parseBasicAuth(
  header: string | undefined,
): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null;
  const raw = header.slice('Basic '.length).trim();
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}
