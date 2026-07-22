/**
 * Badge — Pequeno indicador de status
 */
import React from 'react';
import clsx from 'clsx';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  style?: React.CSSProperties;
}

const variantMap: Record<BadgeVariant, { bg: string; color: string; border: string }> = {
  success: { bg: 'var(--color-success-subtle)', color: 'var(--color-success)', border: 'transparent' },
  warning: { bg: 'var(--color-warning-subtle)', color: 'var(--color-warning)', border: 'transparent' },
  error: { bg: 'var(--color-error-subtle)', color: 'var(--color-error)', border: 'transparent' },
  info: { bg: 'var(--color-primary-subtle)', color: 'var(--color-primary)', border: 'transparent' },
  neutral: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', border: 'transparent' },
};

export function Badge({ children, variant = 'neutral', className, style }: BadgeProps) {
  const v = variantMap[variant];
  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.2rem',
    padding: '0.125rem 0.5rem',
    fontSize: 'var(--text-xs)',
    fontWeight: 500,
    borderRadius: 'var(--radius-full)',
    whiteSpace: 'nowrap',
    lineHeight: 1.5,
    background: v.bg,
    color: v.color,
    border: `1px solid ${v.border}`,
    ...style,
  };

  return (
    <span className={clsx('badge', className)} style={badgeStyle}>
      {children}
    </span>
  );
}
