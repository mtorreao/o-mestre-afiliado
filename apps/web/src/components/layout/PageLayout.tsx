/**
 * PageLayout — Wrapper de página com largura máxima
 */
import React from 'react';

interface PageLayoutProps {
  children: React.ReactNode;
  maxWidth?: string;
  style?: React.CSSProperties;
}

export function PageLayout({ children, maxWidth = '960px', style }: PageLayoutProps) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 'var(--spacing-8) var(--spacing-6)', ...style }}>
      <div style={{ width: '100%', maxWidth, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-6)' }}>
        {children}
      </div>
    </div>
  );
}
