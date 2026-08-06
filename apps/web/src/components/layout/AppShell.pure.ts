export type NavItemId =
  'dashboard' | 'mirrors' | 'mirror-logs' | 'mirror-form' | 'settings' | 'historico-precos';

/**
 * Itens visíveis para qualquer usuário autenticado.
 *
 * Telas admin (worker-status, feature-flags) migraram para `apps/admin-web` —
 * nada aqui depende de role. `historico-precos` continua aqui porque o
 * endpoint `/api/catalog/*` ainda vive na API principal; se migrar no futuro,
 * mover o gate pra `apps/admin-web`.
 */
export const NAV_ITEMS: NavItemId[] = [
  'dashboard',
  'mirrors',
  'mirror-logs',
  'historico-precos',
  'settings',
];

export function isNavItemId(value: string): value is NavItemId {
  return (NAV_ITEMS as readonly string[]).includes(value);
}
