import { describe, expect, it } from 'bun:test';
import { filterNavByRole } from './AppShell.pure.ts';

describe('filterNavByRole', () => {
  it('esconde worker-status para usuários não-admin', () => {
    const items = filterNavByRole(
      ['dashboard', 'mirrors', 'mirror-logs', 'worker-status', 'feature-flags', 'historico-precos'],
      { isAdmin: false, isSuperAdmin: false },
    );
    expect(items).not.toContain('worker-status');
    expect(items).not.toContain('feature-flags');
    expect(items).not.toContain('historico-precos');
  });

  it('mostra feature-flags/historico-precos para admin comum', () => {
    const items = filterNavByRole(
      ['dashboard', 'mirrors', 'mirror-logs', 'worker-status', 'feature-flags', 'historico-precos'],
      { isAdmin: true, isSuperAdmin: false },
    );
    expect(items).toContain('feature-flags');
    expect(items).toContain('historico-precos');
    expect(items).not.toContain('worker-status');
  });

  it('mostra worker-status apenas para super admin', () => {
    const items = filterNavByRole(
      ['dashboard', 'mirrors', 'mirror-logs', 'worker-status', 'feature-flags', 'historico-precos'],
      { isAdmin: true, isSuperAdmin: true },
    );
    expect(items).toContain('worker-status');
    expect(items).toContain('feature-flags');
  });
});
