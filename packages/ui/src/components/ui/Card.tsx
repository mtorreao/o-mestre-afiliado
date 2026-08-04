/**
 * Card — Container de seção com header opcional
 */
import React from 'react';
import clsx from 'clsx';

interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  /** id aplicado ao <h3> do titulo — para nomear o container via aria-labelledby */
  titleId?: string;
}

export function Card({
  children,
  title,
  subtitle,
  action,
  className,
  style,
  titleId,
  ...rest
}: CardProps) {
  const cardStyle: React.CSSProperties = {
    background: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-xl)',
    overflow: 'hidden',
    ...style,
  };

  const headerStyle: React.CSSProperties = {
    padding: '0.5rem 0.75rem',
    borderBottom: '1px solid var(--color-border-light)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.5rem',
  };

  const bodyStyle: React.CSSProperties = {
    padding: '0.75rem',
  };

  return (
    <div className={clsx('Card', className)} style={cardStyle} {...rest}>
      {(title || action) && (
        <div style={headerStyle}>
          <div>
            {title && (
              <h3 id={titleId} style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                style={{
                  margin: '0.15rem 0 0',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {action && <div>{action}</div>}
        </div>
      )}
      <div style={bodyStyle}>{children}</div>
    </div>
  );
}
