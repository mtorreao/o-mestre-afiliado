/**
 * Regra central de super admin: a flag persistida em `users.is_admin`.
 * Promoção é feita via UPDATE manual no banco — não há bootstrap via env.
 */
export function isSuperAdmin(isAdmin: boolean): boolean {
  return isAdmin === true;
}
