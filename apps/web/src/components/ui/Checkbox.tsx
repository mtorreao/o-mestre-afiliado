/**
 * Checkbox — Checkbox acessível via Radix
 */
import React from 'react';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import clsx from 'clsx';

interface CheckboxProps {
  id?: string;
  label?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ id, label, checked, onCheckedChange, disabled, className }: CheckboxProps) {
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-primary)',
    userSelect: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };

  return (
    <label htmlFor={id} style={containerStyle} className={clsx('CheckboxWrapper', className)}>
      <RadixCheckbox.Root
        id={id}
        className="CheckboxRoot"
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      >
        <RadixCheckbox.Indicator className="CheckboxIndicator">
          <Check size={12} strokeWidth={3} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label && <span style={labelStyle}>{label}</span>}
    </label>
  );
}
