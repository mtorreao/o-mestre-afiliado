/**
 * Input — Input com label e erro
 */
import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, id, style, ...props }, ref) => {
    const inputId = id || `input-${label?.toLowerCase().replace(/\s+/g, '-')}`;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
        {label && <label htmlFor={inputId} style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{label}</label>}
        <input
          ref={ref}
          id={inputId}
          style={{
            width: '100%', padding: '0.5rem 0.75rem', fontSize: 'var(--text-sm)',
            lineHeight: 1.5, color: 'var(--color-text-primary)',
            background: 'var(--color-surface)',
            border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-md)', outline: 'none',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
            boxSizing: 'border-box', ...style,
          }}
          onFocus={(e) => {
            if (!error) { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-primary-subtle)'; }
          }}
          onBlur={(e) => {
            if (!error) { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; }
          }}
          {...props}
        />
        {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>{error}</span>}
        {hint && !error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{hint}</span>}
      </div>
    );
  },
);
Input.displayName = 'Input';
