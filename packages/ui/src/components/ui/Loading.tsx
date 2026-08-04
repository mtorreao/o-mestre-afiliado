/**
 * Loading — Spinner e skeleton de carregamento
 */
import React from 'react';
import { Loader2 } from 'lucide-react';
import clsx from 'clsx';

interface LoadingProps {
  text?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const iconSizes = { sm: 16, md: 24, lg: 32 };

export function Loading({ text, size = 'md', className }: LoadingProps) {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    padding: '2.5rem 1rem',
    color: 'var(--color-text-muted)',
  };

  return (
    <div className={clsx('Loading', className)} style={containerStyle}>
      <Loader2
        size={iconSizes[size]}
        style={{ animation: 'spin 0.8s linear infinite', color: 'var(--color-primary)' }}
      />
      {text && <span style={{ fontSize: 'var(--text-sm)' }}>{text}</span>}
    </div>
  );
}

interface LoadingSkeletonProps {
  lines?: number;
  className?: string;
}

export function LoadingSkeleton({ lines = 3, className }: LoadingSkeletonProps) {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    padding: '1rem',
  };

  const barStyle: React.CSSProperties = {
    height: '12px',
    background: 'var(--color-bg-secondary)',
    borderRadius: 'var(--radius-sm)',
    animation: 'pulse 2s ease-in-out infinite',
  };

  return (
    <div className={clsx('LoadingSkeleton', className)} style={containerStyle}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          style={{
            ...barStyle,
            width: i === lines - 1 ? '60%' : '100%',
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
}
