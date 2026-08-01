/**
 * Helpers de autenticação JWT.
 *
 * Uso em rotas protegidas:
 *   import { getAuthUser, getSuperAdminUser } from '../../middleware/auth.ts';
 *
 *   // Em uma rota:
 *   const auth = await getAuthUser(jwtInstance, request.headers);
 *   if (!auth) return { success: false, error: 'Não autenticado' };
 *   // auth = { userId: number, userEmail: string, isAdmin: boolean }
 */

import { t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { UserRepository } from '@omestre/db';
import { isSuperAdmin } from './super-admin.ts';
import { config } from '../config.ts';

export interface AuthUser {
  userId: number;
  userEmail: string;
  isAdmin: boolean;
}

/**
 * Obtém o JWT secret ou gera um aleatório em dev com aviso.
 * Em produção, JWT_SECRET é obrigatório (fail-closed).
 */
function getJwtSecret(): string {
  if (config.JWT_SECRET) return config.JWT_SECRET;

  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    throw new Error('JWT_SECRET is required in production');
  }

  // Gera secret aleatório para dev (não persistente entre restarts)
  const devSecret = crypto.randomUUID();
  console.warn(
    '[SECURITY WARNING] JWT_SECRET not set. Using random dev secret (tokens will not survive restarts).',
  );
  return devSecret;
}

/**
 * Cria o plugin JWT para uso nas rotas.
 */
export function createJwtPlugin() {
  return jwt({
    name: 'jwt',
    secret: getJwtSecret(),
    schema: t.Object({
      userId: t.Number(),
      userEmail: t.String(),
      isAdmin: t.Optional(t.Boolean()),
    }),
  });
}

/**
 * Extrai o usuário autenticado do header Authorization.
 * Retorna null se não autenticado.
 */
export async function getAuthUser(
  jwtInstance: { verify: (token: string) => Promise<Record<string, unknown> | null | false> },
  headers: Headers,
): Promise<AuthUser | null> {
  const authHeader = headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const payload = await jwtInstance.verify(token);

  if (!payload) return null;
  if (typeof payload.userId !== 'number') return null;

  return {
    userId: payload.userId,
    userEmail: String(payload.userEmail ?? ''),
    isAdmin: payload.isAdmin === true,
  };
}

/**
 * Obtém o usuário autenticado e verifica se é super admin.
 * Exige is_admin=true no banco/JWT e email presente em ADMIN_EMAILS.
 * Retorna null se não autenticado ou se qualquer uma das condições falhar.
 */
export async function getSuperAdminUser(
  jwtInstance: { verify: (token: string) => Promise<Record<string, unknown> | null | false> },
  headers: Headers,
  adminEmailsCsv = config.ADMIN_EMAILS,
  findUserById: (id: number) => Promise<{ email: string; isAdmin: boolean } | null> = (id) =>
    new UserRepository().findById(id),
): Promise<AuthUser | null> {
  const tokenUser = await getAuthUser(jwtInstance, headers);
  if (!tokenUser) return null;

  const dbUser = await findUserById(tokenUser.userId);
  if (!dbUser || !isSuperAdmin(dbUser.isAdmin, dbUser.email, adminEmailsCsv)) return null;

  return {
    userId: tokenUser.userId,
    userEmail: dbUser.email,
    isAdmin: dbUser.isAdmin,
  };
}
