/**
 * GroupsPage — Página de Grupos de Espelhamento
 *
 * Placeholder: será implementada pela task t_ac0509a1
 */
import React from 'react';

interface GroupsPageProps {
  token: string;
}

export function GroupsPage({ token }: GroupsPageProps) {
  return (
    <div style={{ padding: 'var(--spacing-6)' }}>
      <div
        style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--spacing-8)',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
        }}
      >
        Grupos de Espelhamento — em breve
      </div>
    </div>
  );
}
