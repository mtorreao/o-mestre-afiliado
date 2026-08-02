import { Elysia, t } from 'elysia';
import { UserRepository, UserCredentialsRepository, isEmailAdminAllowed } from '@omestre/db';
import { createJwtPlugin, getAuthUser, getSuperAdminUser } from '../../middleware/auth.ts';
import {
  getClientIp,
  IpRateLimiter,
  LOGIN_MAX_REQUESTS,
  LOGIN_WINDOW_MS,
  RateLimitError,
  REGISTER_MAX_REQUESTS,
  REGISTER_WINDOW_MS,
} from '../../middleware/auth-rate-limit-pure.ts';
import { config } from '../../config.ts';

const userRepo = new UserRepository();
const credentialsRepo = new UserCredentialsRepository();

// ─── Rate limiters (singleton por processo) ────────────────────────────────
const loginLimiter = new IpRateLimiter({
  maxRequests: LOGIN_MAX_REQUESTS,
  windowMs: LOGIN_WINDOW_MS,
});
const registerLimiter = new IpRateLimiter({
  maxRequests: REGISTER_MAX_REQUESTS,
  windowMs: REGISTER_WINDOW_MS,
});

/** Prune periódicos para evitar unbounded growth em produção. */
function pruneLimiters(): void {
  loginLimiter.prune();
  registerLimiter.prune();
}

export const authRoutes = new Elysia()
  // ─── Plugin JWT ───────────────────────────────────────────────────
  .use(createJwtPlugin())

  // ─── POST /api/auth/register ──────────────────────────────────────
  .post(
    '/api/auth/register',
    async ({ body, jwt, request, set }) => {
      // Rate limit por IP (3 registros/hora)
      const ip = getClientIp(request.headers);
      try {
        registerLimiter.check(ip);
      } catch (err) {
        if (err instanceof RateLimitError) {
          set.status = 429;
          set.headers['Retry-After'] = String(Math.ceil(err.retryAfterMs / 1000));
          return { success: false, error: err.message, retryAfterMs: err.retryAfterMs };
        }
        throw err;
      }
      pruneLimiters();

      const { email, name, password } = body as { email: string; name: string; password: string };

      if (!email || !name || !password) {
        set.status = 400;
        return { success: false, error: 'Email, nome e senha são obrigatórios' };
      }

      if (password.length < 6) {
        set.status = 400;
        return { success: false, error: 'Senha deve ter pelo menos 6 caracteres' };
      }

      const existing = await userRepo.findByEmail(email);
      if (existing) {
        set.status = 409;
        return { success: false, error: 'Email já cadastrado' };
      }

      const passwordHash = await Bun.password.hash(password);
      // Admin bootstrap via env: emails em ADMIN_EMAILS nascem admin.
      const isAdmin = isEmailAdminAllowed(email, config.ADMIN_EMAILS);
      const user = await userRepo.create({ email, name, passwordHash, isAdmin });

      await credentialsRepo.upsert(user.id, {});

      const token = await jwt.sign({
        userId: user.id,
        userEmail: user.email,
        isAdmin,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 dias
      });

      return {
        success: true,
        token,
        user: { id: user.id, email: user.email, name: user.name, isAdmin },
      };
    },
    {
      detail: {
        summary: 'Registrar novo usuário',
        description: 'Cria uma conta com email e senha',
      },
    },
  )

  // ─── POST /api/auth/login ─────────────────────────────────────────
  .post(
    '/api/auth/login',
    async ({ body, jwt, request, set }) => {
      // Rate limit por IP (5 tentativas/minuto) — brute force protection
      const ip = getClientIp(request.headers);
      try {
        loginLimiter.check(ip);
      } catch (err) {
        if (err instanceof RateLimitError) {
          set.status = 429;
          set.headers['Retry-After'] = String(Math.ceil(err.retryAfterMs / 1000));
          return { success: false, error: err.message, retryAfterMs: err.retryAfterMs };
        }
        throw err;
      }
      pruneLimiters();

      const { email, password } = body as { email: string; password: string };

      if (!email || !password) {
        set.status = 400;
        return { success: false, error: 'Email e senha são obrigatórios' };
      }

      const user = await userRepo.findByEmail(email);
      if (!user) {
        set.status = 401;
        return { success: false, error: 'Email ou senha inválidos' };
      }

      const valid = await Bun.password.verify(password, user.passwordHash);
      if (!valid) {
        set.status = 401;
        return { success: false, error: 'Email ou senha inválidos' };
      }

      // Admin bootstrap via env: se o email entrou em ADMIN_EMAILS depois do
      // cadastro, promove no DB (idempotente) e usa o valor atualizado no JWT.
      // Se o email foi removido da lista, mantém o valor atual do DB.
      // Fail-closed: se o UPDATE não retornar linha (e-mail sumiu do banco
      // entre o find e o UPDATE, etc.), cai pro default seguro (false) em
      // vez de presentear o usuário com admin.
      let isAdmin = user.isAdmin;
      if (!isAdmin && isEmailAdminAllowed(email, config.ADMIN_EMAILS)) {
        const updated = await userRepo.promoteToAdmin(email);
        isAdmin = updated?.isAdmin ?? false;
      }

      const token = await jwt.sign({
        userId: user.id,
        userEmail: user.email,
        isAdmin,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 dias
      });

      return {
        success: true,
        token,
        user: { id: user.id, email: user.email, name: user.name, isAdmin },
      };
    },
    {
      detail: {
        summary: 'Fazer login',
        description: 'Autentica com email e senha, retorna JWT',
      },
    },
  )

  // ─── GET /api/auth/me ─────────────────────────────────────────────
  .get(
    '/api/auth/me',
    async ({ jwt, request, set }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const user = await userRepo.findPublicById(auth.userId);
      if (!user) {
        return { success: false, error: 'Usuário não encontrado' };
      }

      const isSuperAdmin = !!(await getSuperAdminUser(jwt, request.headers));

      return {
        success: true,
        user: { ...user, isSuperAdmin },
      };
    },
    {
      detail: {
        summary: 'Dados do usuário logado',
        description: 'Retorna os dados do usuário autenticado',
      },
    },
  );
