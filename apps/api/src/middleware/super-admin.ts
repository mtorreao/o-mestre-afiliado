import { isEmailAdminAllowed } from '@omestre/db';

/**
 * Regra central de super admin: a flag persistida e a allow-list do ambiente
 * precisam autorizar o mesmo usuário. A lista vazia falha fechada.
 */
export function isSuperAdmin(
  isAdmin: boolean,
  email: string,
  adminEmailsCsv: string | undefined,
): boolean {
  return isAdmin === true && isEmailAdminAllowed(email, adminEmailsCsv);
}
