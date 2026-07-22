/**
 * Checkbox — Radix Checkbox
 */
import React from 'react';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';

interface CheckboxProps { id?: string; label?: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean; }

export function Checkbox({ id, label, checked, onCheckedChange, disabled }: CheckboxProps) {
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <RadixCheckbox.Root id={id} className="CheckboxRoot" checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <RadixCheckbox.Indicator className="CheckboxIndicator"><Check size={12} strokeWidth={3} /></RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      {label && <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', userSelect: 'none' }}>{label}</span>}
    </label>
  );
}
