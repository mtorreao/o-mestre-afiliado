/**
 * Button — Botão reutilizável
 */
import React from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const variants: Record<ButtonVariant, React.CSSProperties> = {
  primary: { background: 'var(--color-primary)', color: '#fff', border: 'none' },
  secondary: { background: 'var(--color-bg-secondary)', color: 'var(--color-text-primary)', border: '1px solid var(--color-border)' },
  outline: { background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' },
  ghost: { background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid transparent' },
  danger: { background: 'var(--color-error)', color: '#fff', border: 'none' },
};

const sizes: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: '0.3rem 0.6rem', fontSize: 'var(--text-xs)', gap: '0.3rem' },
  md: { padding: '0.5rem 1rem', fontSize: 'var(--text-sm)', gap: '0.4rem' },
  lg: { padding: '0.625rem 1.25rem', fontSize: 'var(--text-base)', gap: '0.5rem' },
};

export function Button({ variant = 'primary', size = 'md', loading, icon, children, disabled, style, ...props }: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <button
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 500, borderRadius: 'var(--radius-md)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        transition: 'all var(--transition-fast)',
        lineHeight: 1.4, whiteSpace: 'nowrap', outline: 'none',
        opacity: isDisabled ? 0.6 : 1,
        ...sizes[size], ...variants[variant], ...style,
      }}
      disabled={isDisabled}
      onMouseEnter={(e) => {
        if (isDisabled) return;
        const el = e.currentTarget as HTMLButtonElement;
        if (variant === 'primary') el.style.background = 'var(--color-primary-hover)';
        if (variant === 'outline') el.style.background = 'var(--color-primary-subtle)';
        if (variant === 'ghost') el.style.background = 'var(--color-surface-hover)';
      }}
      onMouseLeave={(e) => {
        if (isDisabled) return;
        const el = e.currentTarget as HTMLButtonElement;
        if (variant === 'primary') el.style.background = 'var(--color-primary)';
        if (variant === 'outline') el.style.background = 'transparent';
        if (variant === 'ghost') el.style.background = 'transparent';
      }}
      {...props}
    >
      {loading ? <Loader2 size={size === 'sm' ? 14 : size === 'lg' ? 20 : 16} style={{ animation: 'spin 0.8s linear infinite' }} /> : icon}
      {children}
    </button>
  );
}
