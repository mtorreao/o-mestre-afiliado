export type NavItemId =
  | 'dashboard'
  | 'mirrors'
  | 'mirror-logs'
  | 'mirror-form'
  | 'worker-status'
  | 'feature-flags'
  | 'historico-precos';

export interface RoleState {
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

const ADMIN_ONLY: NavItemId[] = ['feature-flags', 'historico-precos'];
const SUPER_ADMIN_ONLY: NavItemId[] = ['worker-status'];

/**
 * Centraliza o filtro de itens da sidebar por papel.
 * - `worker-status` exige `isSuperAdmin` (gate duplo: ADMIN_EMAILS + is_admin).
 * - `feature-flags` / `historico-precos` exigem apenas `isAdmin`.
 * - O resto fica sempre visível.
 */
export function filterNavByRole(items: NavItemId[], role: RoleState): NavItemId[] {
  return items.filter((id) => {
    if (SUPER_ADMIN_ONLY.includes(id)) return role.isSuperAdmin;
    if (ADMIN_ONLY.includes(id)) return role.isAdmin;
    return true;
  });
}
