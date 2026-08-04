/**
 * Rotas de autenticação — login (Basic) + logout (session).
 *
 * POST /api/admin/auth/login     → valida user+senha, cria sessão, devolve token
 * POST /api/admin/auth/logout    → invalida sessão
 * GET  /api/admin/auth/me        → checa sessão atual (pro admin-web)
 */

import { Hono } from 'hono';
import type { Logger } from '../config.ts';
import {
  createSession,
  destroySession,
  parseBasicAuth,
  safeEqual,
  sessionAuth,
  verifyPassword,
  type AuthEnv,
} from '../auth.ts';

export function authRoutes(log: Logger): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();

  app.post('/login', async (c) => {
    const header = c.req.header('Authorization');
    const parsed = parseBasicAuth(header);
    if (!parsed) {
      return c.json({ success: false, error: 'missing basic auth' }, 400);
    }

    const expectedUser = process.env['OMA_ADMIN_USER'] ?? '';
    const expectedHash = process.env['OMA_ADMIN_PASSWORD_HASH'] ?? '';

    // Username check constante-tempo também.
    const userOk = safeEqual(parsed.user, expectedUser);
    if (!userOk) {
      log.warn('tentativa de login com usuário inválido', { user: parsed.user });
      return c.json({ success: false, error: 'invalid credentials' }, 401);
    }

    const passOk = await verifyPassword(parsed.password, expectedHash);
    if (!passOk) {
      log.warn('tentativa de login com senha inválida', { user: parsed.user });
      return c.json({ success: false, error: 'invalid credentials' }, 401);
    }

    const token = createSession();
    log.info('login bem-sucedido', { user: parsed.user });
    return c.json({ success: true, token, expiresIn: 12 * 60 * 60 });
  });

  app.post('/logout', sessionAuth(), (c) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.slice('Bearer '.length).trim();
    destroySession(token);
    return c.json({ success: true });
  });

  app.get('/me', sessionAuth(), (c) => {
    return c.json({ success: true, user: 'admin' });
  });

  return app;
}
