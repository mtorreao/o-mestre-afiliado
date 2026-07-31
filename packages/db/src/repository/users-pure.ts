/**
 * Lógica PURA do repositório de usuários.
 *
 * Separa o mapeamento para dados públicos (remoção de password_hash, que
 * não depende de DB) das operações de I/O. Função síncrona, 100% testável
 * sem PostgreSQL.
 */

export interface UserPublic {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Retorna os dados públicos de um User (remove password_hash).
 * Lança se o usuário for nulo (o repo original só chama após checagem).
 */
export function toUserPublic(user: {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  createdAt: Date;
  updatedAt: Date;
  passwordHash: string;
}): UserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin === true,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Decide se um email deve virar admin baseado no env ADMIN_EMAILS (CSV).
 *
 * - Match exato, case-insensitive, trimmed.
 * - Emails vazios na lista são ignorados.
 * - Lista vazia / undefined → ninguém é admin via env (retorna false).
 */
export function isEmailAdminAllowed(email: string, adminEmailsCsv: string | undefined): boolean {
  if (!adminEmailsCsv) return false;
  const allowed = adminEmailsCsv
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
