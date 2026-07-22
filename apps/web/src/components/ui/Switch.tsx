/**
 * Switch — Radix Switch
 */
import React from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';

interface SwitchProps { id?: string; label?: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; }

export function Switch({ id, label, checked, onCheckedChange, disabled }: SwitchProps) {
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <RadixSwitch.Root id={id} className="SwitchRoot" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <RadixSwitch.Thumb className="SwitchThumb" />
      </RadixSwitch.Root>
      {label && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', userSelect: 'none' }}>{label}</span>}
    </label>
  );
}
