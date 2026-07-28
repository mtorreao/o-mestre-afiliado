/**
 * Helpers de autenticação JWT.
 *
 * Uso em rotas protegidas:
 *   import { getAuthUser, getAdminUser } from '../../middleware/auth.ts';
 *
 *   // Em uma rota:
 *   const auth = await getAuthUser(jwtInstance, request.headers);
 *   if (!auth) return { success: false, error: 'Não autenticado' };
 *   // auth = { userId: number, userEmail: string, isAdmin: boolean }
 */

import { t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { config } from '../config.ts';

export interface AuthUser {
  userId: number;
  userEmail: string;
  isAdmin: boolean;
}

/**
 * Cria o plugin JWT para uso nas rotas.
 */
export function createJwtPlugin() {
  return jwt({
    name: 'jwt',
    secret: config.JWT_SECRET || 'omestre-dev-secret-change-in-production',
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
 * Obtém o usuário autenticado e verifica se é admin.
 * Retorna o AuthUser se for admin, ou null se não autenticado/não admin.
 */
export async function getAdminUser(
  jwtInstance: { verify: (token: string) => Promise<Record<string, unknown> | null | false> },
  headers: Headers,
): Promise<AuthUser | null> {
  const user = await getAuthUser(jwtInstance, headers);
  if (!user?.isAdmin) return null;
  return user;
}
