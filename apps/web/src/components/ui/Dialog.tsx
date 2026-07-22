/**
 * Dialog — Modal Radix
 */
import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

interface DialogProps {
  open: boolean; onOpenChange: (open: boolean) => void;
  title: string; description?: string; children: React.ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="DialogOverlay" />
        <RadixDialog.Content className="DialogContent">
          <div style={{ padding: '1.5rem 1.5rem 0.5rem' }}>
            <RadixDialog.Title style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0, paddingRight: '2rem' }}>{title}</RadixDialog.Title>
            {description && <RadixDialog.Description style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: '0.25rem' }}>{description}</RadixDialog.Description>}
          </div>
          <div style={{ padding: '0.5rem 1.5rem 1.5rem' }}>{children}</div>
          <RadixDialog.Close asChild>
            <button style={{ position: 'absolute', top: '1rem', right: '1rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'transparent', color: 'var(--color-text-muted)', cursor: 'pointer' }} aria-label="Close">
              <X size={16} />
            </button>
          </RadixDialog.Close>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
