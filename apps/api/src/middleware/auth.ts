/**
 * Helpers de autenticação JWT.
 *
 * Uso em rotas protegidas:
 *   import { getAuthUser, requireAuth } from '../../middleware/auth.ts';
 *
 *   // Em uma rota:
 *   const auth = await getAuthUser(jwtInstance, request.headers);
 *   if (!auth) return { success: false, error: 'Não autenticado' };
 *   // auth = { userId: number, userEmail: string }
 */

import { t } from 'elysia';
import { jwt } from '@elysiajs/jwt';

const JWT_SECRET = process.env.JWT_SECRET || 'omestre-dev-secret-change-in-production';

export interface AuthUser {
  userId: number;
  userEmail: string;
}

/**
 * Cria o plugin JWT para uso nas rotas.
 * Cada módulo que precisa de auth deve chamar esta função
 * e incluir o retorno no Elysia.
 */
export function createJwtPlugin() {
  return jwt({
    name: 'jwt',
    secret: JWT_SECRET,
    schema: t.Object({
      userId: t.Number(),
      userEmail: t.String(),
    }),
  });
}

/**
 * Extrai o usuário autenticado de um request.
 * Retorna null se o token for inválido ou ausente.
 *
 * Aceita o jwtInstance do plugin @elysiajs/jwt (qualquer versão).
 */
export async function getAuthUser(
  jwtInstance: { verify: (token?: string) => Promise<Record<string, unknown> | null | false> },
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
  };
}
