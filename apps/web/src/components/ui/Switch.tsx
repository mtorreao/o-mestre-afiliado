/**
 * Switch — Toggle switch via Radix
 */
import React from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import clsx from 'clsx';

interface SwitchProps {
  id?: string;
  label?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function Switch({ id, label, checked, onCheckedChange, disabled, className }: SwitchProps) {
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
    <label htmlFor={id} style={containerStyle} className={clsx('SwitchWrapper', className)}>
      <RadixSwitch.Root id={id} className="SwitchRoot" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <RadixSwitch.Thumb className="SwitchThumb" />
      </RadixSwitch.Root>
      {label && <span style={labelStyle}>{label}</span>}
    </label>
  );
}
