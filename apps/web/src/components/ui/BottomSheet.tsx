/**
 * BottomSheet — Painel que desliza de baixo para cima (mobile-first)
 *
 * Uso:
 *   <BottomSheet open={open} onOpenChange={setOpen} title="Filtros">
 *     <div>conteúdo aqui</div>
 *   </BottomSheet>
 */
import React from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X, Filter } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: React.ReactNode;
  /** Número de filtros ativos para exibir no badge */
  activeCount?: number;
  trigger?: React.ReactNode;
}

export function BottomSheet({ open, onOpenChange, title, children, trigger }: BottomSheetProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && (
        <RadixDialog.Trigger asChild>
          {trigger}
        </RadixDialog.Trigger>
      )}
      <RadixDialog.Portal>
        {/* Overlay escuro */}
        <RadixDialog.Overlay
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            zIndex: 100,
            animation: 'fadeIn 0.2s',
          }}
        />
        {/* Sheet que sobe de baixo */}
        <RadixDialog.Content
          style={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            maxHeight: '85vh',
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
            boxShadow: '0 -8px 30px rgba(0,0,0,0.12)',
            zIndex: 101,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideUp 0.25s ease-out',
            overflow: 'hidden',
          }}
        >
          {/* Handle visual (drag indicator) */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: '0.5rem 0 0',
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: '36px',
                height: '4px',
                borderRadius: '2px',
                background: 'var(--color-border)',
              }}
            />
          </div>

          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1.25rem',
              borderBottom: '1px solid var(--color-border-light)',
              flexShrink: 0,
            }}
          >
            <h2
              style={{
                margin: 0,
                fontSize: 'var(--text-base)',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
              }}
            >
              {title || 'Filtros'}
            </h2>
            <RadixDialog.Close asChild>
              <button
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                }}
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </RadixDialog.Close>
          </div>

          {/* Conteúdo rolável */}
          <div
            style={{
              padding: '1.25rem',
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {children}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>

      {/* Animações via style tag (inline pro componente funcionar standalone) */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
    </RadixDialog.Root>
  );
}
