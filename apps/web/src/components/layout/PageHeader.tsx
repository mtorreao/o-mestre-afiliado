/**
 * PageHeader — Cabeçalho de página padronizado
 */
import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button.tsx';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export function PageHeader({ title, subtitle, onBack, actions }: PageHeaderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--spacing-4)', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-3)', minWidth: 0 }}>
        {onBack && <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft size={16} />} aria-label="Voltar" />}
        <div>
          <h1 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 600 }}>{title}</h1>
          {subtitle && <p style={{ margin: '0.15rem 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>{subtitle}</p>}
        </div>
      </div>
      {actions && <div style={{ display: 'flex', gap: 'var(--spacing-2)', alignItems: 'center', flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}
