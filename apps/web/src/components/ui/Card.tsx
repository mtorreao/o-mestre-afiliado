/**
 * Card — Container de seção
 */
import React from 'react';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  style?: React.CSSProperties;
}

export function Card({ children, title, subtitle, action, style }: CardProps) {
  return (
    <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', ...style }}>
      {(title || action) && (
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            {title && <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>{title}</h3>}
            {subtitle && <p style={{ margin: '0.15rem 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{subtitle}</p>}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div style={{ padding: '1.25rem' }}>{children}</div>
    </div>
  );
}
