/**
 * Badge — Indicador de status
 */
import React from 'react';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  style?: React.CSSProperties;
}

const v: Record<BadgeVariant, { bg: string; color: string }> = {
  success: { bg: 'var(--color-success-subtle)', color: 'var(--color-success)' },
  warning: { bg: 'var(--color-warning-subtle)', color: 'var(--color-warning)' },
  error: { bg: 'var(--color-error-subtle)', color: 'var(--color-error)' },
  info: { bg: 'var(--color-primary-subtle)', color: 'var(--color-primary)' },
  neutral: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)' },
};

export function Badge({ children, variant = 'neutral', style }: BadgeProps) {
  const c = v[variant];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.125rem 0.5rem', fontSize: 'var(--text-xs)', fontWeight: 500, borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap', lineHeight: 1.5, background: c.bg, color: c.color, ...style }}>
      {children}
    </span>
  );
}
