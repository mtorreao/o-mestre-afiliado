import { Elysia, t } from 'elysia';
import {
  UserRepository,
  UserCredentialsRepository,
  AuthRefreshTokenRepository,
  isEmailAdminAllowed,
} from '@omestre/db';
import { createJwtPlugin, getAuthUser, getSuperAdminUser } from '../../middleware/auth.ts';
import {
  getClientIp,
  IpRateLimiter,
  isRateLimitEnabled,
  LOGIN_MAX_REQUESTS,
  LOGIN_WINDOW_MS,
  RateLimitError,
  REGISTER_MAX_REQUESTS,
  REGISTER_WINDOW_MS,
} from '../../middleware/auth-rate-limit-pure.ts';
import {
  buildAccessTokenExpiry,
  hashRefreshToken,
  issueRefreshToken,
} from '../../middleware/token-pure.ts';
import { refreshSession } from './refresh-session.ts';
import { config } from '../../config.ts';

const userRepo = new UserRepository();
const credentialsRepo = new UserCredentialsRepository();
const refreshTokenRepo = new AuthRefreshTokenRepository();

// ---------- Rate limiters (singleton por processo) ----------------
const loginLimiter = new IpRateLimiter({
  maxRequests: LOGIN_MAX_REQUESTS,
  windowMs: LOGIN_WINDOW_MS,
});
const registerLimiter = new IpRateLimiter({
  maxRequests: REGISTER_MAX_REQUESTS,
  windowMs: REGISTER_WINDOW_MS,
});

/** Prune dos limiters para evitar unbounded growth em producao. */
function pruneLimiters(): void {
  loginLimiter.prune();
  registerLimiter.prune();
}

export const authRoutes = new Elysia()
  // ---- Plugin JWT ---------------------------------------------------
  .use(createJwtPlugin())

  // ---- POST /api/auth/register --------------------------------------
  .post(
    '/api/auth/register',
    async ({ body, jwt, request, set }) => {
      // Rate limit por IP (3 registros/hora) — desabilitado em test
      const ip = getClientIp(request.headers);
      if (isRateLimitEnabled(process.env.NODE_ENV)) {
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
      }

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
        return { success: false, error: 'Email ja cadastrado' };
      }

      const passwordHash = await Bun.password.hash(password);
      const isAdmin = isEmailAdminAllowed(email, config.ADMIN_EMAILS);
      const user = await userRepo.create({ email, name, passwordHash, isAdmin });
      await credentialsRepo.upsert(user.id, {});

      const issue = issueRefreshToken();
      await refreshTokenRepo.create({
        userId: user.id,
        tokenHash: issue.hash,
        familyId: issue.familyId,
        expiresAt: issue.expiresAt,
      });

      const token = await jwt.sign({
        userId: user.id,
        userEmail: user.email,
        isAdmin,
        exp: buildAccessTokenExpiry(),
      });

      return {
        success: true,
        token,
        refreshToken: issue.token,
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

  // ---- POST /api/auth/login -----------------------------------------
  .post(
    '/api/auth/login',
    async ({ body, jwt, request, set }) => {
      const ip = getClientIp(request.headers);
      if (isRateLimitEnabled(process.env.NODE_ENV)) {
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
      }

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

      let isAdmin = user.isAdmin;
      if (!isAdmin && isEmailAdminAllowed(email, config.ADMIN_EMAILS)) {
        const updated = await userRepo.promoteToAdmin(email);
        isAdmin = updated?.isAdmin ?? false;
      }

      const issue = issueRefreshToken();
      await refreshTokenRepo.create({
        userId: user.id,
        tokenHash: issue.hash,
        familyId: issue.familyId,
        expiresAt: issue.expiresAt,
      });

      const token = await jwt.sign({
        userId: user.id,
        userEmail: user.email,
        isAdmin,
        exp: buildAccessTokenExpiry(),
      });

      return {
        success: true,
        token,
        refreshToken: issue.token,
        user: { id: user.id, email: user.email, name: user.name, isAdmin },
      };
    },
    {
      detail: {
        summary: 'Fazer login',
        description: 'Autentica com email e senha, retorna access + refresh token',
      },
    },
  )

  // ---- POST /api/auth/refresh ------------------------------------------------
  .post(
    '/api/auth/refresh',
    async ({ body, jwt, set }) => {
      const { refreshToken } = body as { refreshToken?: string };
      const result = await refreshSession(refreshToken, {
        refreshTokenRepo,
        userRepo,
        jwtSign: (payload) => jwt.sign(payload),
      });
      set.status = result.status;
      if (result.ok) {
        return { success: true, token: result.token, refreshToken: result.refreshToken };
      }
      return { success: false, error: result.error };
    },
    {
      detail: {
        summary: 'Rotacionar sessão',
        description: 'Troca por novo access + refresh (rotação), detectando replay',
      },
    },
  )

  // ---- POST /api/auth/logout ----------------------------------------
  .post(
    '/api/auth/logout',
    async ({ body }) => {
      const { refreshToken } = body as { refreshToken?: string };
      if (refreshToken) {
        const hash = hashRefreshToken(refreshToken);
        const row = await refreshTokenRepo.findByHashIncludingRevoked(hash);
        if (row && row.revokedAt == null) {
          await refreshTokenRepo.revokeById(row.id);
        }
      }
      return { success: true };
    },
    {
      detail: {
        summary: 'Encerrar sessão',
        description: 'Revoga o refresh token (idempotente)',
      },
    },
  )

  // ---- GET /api/auth/me ---------------------------------------------
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
