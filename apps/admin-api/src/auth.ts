/**
 * Autenticação single-user — Basic Auth com senha hasheada (argon2id via Bun).
 *
 * Design:
 *  - Um único usuário (admin). Não há cadastro, não há recuperação.
 *  - Senha nunca viaja em texto puro: só o hash argon2id fica no .env.
 *  - O fluxo de login é o Basic Auth padrão: o browser manda
 *    `Authorization: Basic base64(user:pass)`.
 *  - Sessão: emitimos um token de sessão (random 32 bytes hex) após login
 *    bem-sucedido; o client envia em `Authorization: Bearer <token>`.
 *    Isso evita re-hashear argon2id a cada request (argon2id é caro por design).
 *
 * Sem dependência de lib: usa `Bun.password` (argon2id nativo do runtime).
 */

import type { Context, MiddlewareHandler } from 'hono';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// ─── Hash ────────────────────────────────────────────────────────────────

/** Gera hash argon2id (formato Bun). */
export function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'argon2id' });
}

/** Verifica senha contra hash argon2id (constante-tempo). */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

// ─── Sessões (em memória, single-user) ───────────────────────────────────

interface Session {
  token: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h
const sessions = new Map<string, Session>();

/** Cria sessão e retorna token. */
export function createSession(): string {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  sessions.set(token, { token, createdAt: now, expiresAt: now + SESSION_TTL_MS });
  // Limpeza preguiçosa: remove expiradas a cada nova criação.
  for (const [t, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(t);
  }
  return token;
}

/** Valida token de sessão. */
export function isValidSession(token: string): boolean {
  const s = sessions.get(token);
  if (!s) return false;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/** Remove sessão (logout). */
export function destroySession(token: string): void {
  sessions.delete(token);
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
    if (!isValidSession(token)) {
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
