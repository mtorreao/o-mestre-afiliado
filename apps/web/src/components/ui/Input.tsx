/**
 * Input — Componente de input reutilizável com label e estado de erro
 */
import React, { forwardRef } from 'react';
import clsx from 'clsx';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, style, className, ...props }, ref) => {
    const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`;

    const containerStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      gap: '0.3rem',
    };

    const labelStyle: React.CSSProperties = {
      fontSize: 'var(--text-xs)',
      fontWeight: 500,
      color: 'var(--color-text-secondary)',
    };

    const inputStyle: React.CSSProperties = {
      width: '100%',
      padding: '0.5rem 0.75rem',
      fontSize: 'var(--text-sm)',
      lineHeight: 1.5,
      color: 'var(--color-text-primary)',
      background: 'var(--color-surface)',
      border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
      borderRadius: 'var(--radius-md)',
      outline: 'none',
      transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
      boxSizing: 'border-box',
      ...style,
    };

    const errorStyle: React.CSSProperties = {
      fontSize: 'var(--text-xs)',
      color: 'var(--color-error)',
    };

    const hintStyle: React.CSSProperties = {
      fontSize: 'var(--text-xs)',
      color: 'var(--color-text-muted)',
    };

    return (
      <div style={containerStyle} className={clsx('InputWrapper', className)}>
        {label && (
          <label htmlFor={inputId} style={labelStyle}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          style={{
            ...inputStyle,
            ...(error ? { borderColor: 'var(--color-error)' } : {}),
          }}
          onFocus={(e) => {
            if (!error) {
              (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-primary)';
              (e.currentTarget as HTMLInputElement).style.boxShadow = '0 0 0 3px var(--color-primary-subtle)';
            }
          }}
          onBlur={(e) => {
            if (!error) {
              (e.currentTarget as HTMLInputElement).style.borderColor = 'var(--color-border)';
              (e.currentTarget as HTMLInputElement).style.boxShadow = 'none';
            }
          }}
          {...props}
        />
        {error && <span style={errorStyle}>{error}</span>}
        {hint && !error && <span style={hintStyle}>{hint}</span>}
      </div>
    );
  },
);

Input.displayName = 'Input';
