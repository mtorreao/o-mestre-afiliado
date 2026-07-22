/**
 * PageHeader — Cabeçalho de página padronizado
 *
 * Inclui breadcrumb/back, título, subtitle e ações.
 */
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../ui/Button.tsx';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, onBack, actions, className, children }: PageHeaderProps) {
  const headerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 'var(--spacing-4)',
    flexWrap: 'wrap',
  };

  const leftStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--spacing-3)',
    minWidth: 0,
  };

  const titleBlockStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.15rem',
  };

  return (
    <div className={clsx('PageHeader', className)} style={headerStyle}>
      <div style={leftStyle}>
        {onBack && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            icon={<ArrowLeft size={16} />}
            aria-label="Voltar"
          />
        )}
        <div style={titleBlockStyle}>
          <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 600 }}>{title}</h1>
          {subtitle && (
            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexShrink: 0 }}>
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
