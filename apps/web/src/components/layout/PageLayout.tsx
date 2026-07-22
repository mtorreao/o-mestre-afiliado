/**
 * PageLayout — Wrapper padrão para páginas
 *
 * Fornece largura máxima, padding e estrutura consistente.
 */
import React from 'react';
import clsx from 'clsx';

interface PageLayoutProps {
  children: React.ReactNode;
  maxWidth?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function PageLayout({ children, maxWidth = '960px', className, style }: PageLayoutProps) {
  const layoutStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    padding: 'var(--spacing-8) var(--spacing-6)',
    ...style,
  };

  const innerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth,
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--spacing-6)',
  };

  return (
    <div className={clsx('PageLayout', className)} style={layoutStyle}>
      <div style={innerStyle}>{children}</div>
      <style>{`
        @media (max-width: 768px) {
          .PageLayout {
            padding: 1rem !important;
          }
        }
      `}</style>
    </div>
  );
}
