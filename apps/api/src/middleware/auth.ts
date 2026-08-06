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
import { resolveJwtSecret } from './jwt-secret-pure.ts';

export interface AuthUser {
  userId: number;
  userEmail: string;
  isAdmin: boolean;
}

/**
 * Cria o plugin JWT para uso nas rotas.
 */
export function createJwtPlugin() {
  const { secret } = resolveJwtSecret(config.JWT_SECRET, process.env.NODE_ENV);
  return jwt({
    name: 'jwt',
    secret,
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
 * Exige `is_admin=true` no banco (consultado por userId). Promoção é feita
 * via UPDATE manual no DB — não há mais bootstrap por env.
 * Retorna null se não autenticado ou se a condição falhar.
 */
export async function getSuperAdminUser(
  jwtInstance: { verify: (token: string) => Promise<Record<string, unknown> | null | false> },
  headers: Headers,
  findUserById: (id: number) => Promise<{ isAdmin: boolean } | null> = (id) =>
    new UserRepository().findById(id),
): Promise<AuthUser | null> {
  const tokenUser = await getAuthUser(jwtInstance, headers);
  if (!tokenUser) return null;

  const dbUser = await findUserById(tokenUser.userId);
  if (!dbUser || !isSuperAdmin(dbUser.isAdmin)) return null;

  return {
    userId: tokenUser.userId,
    userEmail: tokenUser.userEmail,
    isAdmin: dbUser.isAdmin,
  };
}
