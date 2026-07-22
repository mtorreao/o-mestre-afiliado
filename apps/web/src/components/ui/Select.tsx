/**
 * Select — Wrapper Radix Select
 */
import React from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';

interface SelectOption { value: string; label: string; }
interface SelectProps {
  label?: string; placeholder?: string; value: string;
  onValueChange: (value: string) => void; options: SelectOption[];
  error?: string | null; disabled?: boolean;
}

export function Select({ label, placeholder = 'Selecionar...', value, onValueChange, options, error, disabled }: SelectProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {label && <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)' }}>{label}</span>}
      <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <RadixSelect.Trigger className="SelectTrigger" style={error ? { borderColor: 'var(--color-error)' } : undefined}>
          <RadixSelect.Value placeholder={placeholder} />
          <RadixSelect.Icon><ChevronDown size={16} style={{ color: 'var(--color-text-muted)' }} /></RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="SelectContent" position="popper" sideOffset={4}>
            <RadixSelect.Viewport className="SelectViewport">
              {options.map((opt) => (
                <RadixSelect.Item key={opt.value} value={opt.value} className="SelectItem">
                  <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                  <RadixSelect.ItemIndicator className="SelectIndicator"><Check size={14} /></RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
      {error && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>{error}</span>}
    </div>
  );
}
