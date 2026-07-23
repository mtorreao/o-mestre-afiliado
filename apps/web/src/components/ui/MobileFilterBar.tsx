/**
 * MobileFilterBar — Botão de filtros + BottomSheet para mobile
 *
 * Mostra um botão "Filtros" que, ao tocar, abre um BottomSheet
 * com os campos de filtro empilhados verticalmente e ações no rodapé.
 *
 * Uso:
 *   <MobileFilterBar
 *     label="Filtros"
 *     actions={<Button onClick={handleSearch}>Filtrar</Button>}
 *   >
 *     <div>campos de filtro aqui (sem FilterBar.Item, são full-width)</div>
 *   </MobileFilterBar>
 */
import React from 'react';
import { Filter } from 'lucide-react';
import { Button } from './Button.tsx';
import { BottomSheet } from './BottomSheet.tsx';

interface MobileFilterBarProps {
  children: React.ReactNode;
  /** Rótulo do botão e título do BottomSheet */
  label?: string;
  /** Ações no rodapé do BottomSheet (ex: Limpar, Filtrar) */
  actions?: React.ReactNode;
}

export function MobileFilterBar({ children, label = 'Filtros', actions }: MobileFilterBarProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title={label}
        trigger={
          <Button
            variant="outline"
            onClick={() => setOpen(true)}
            icon={<Filter size={14} />}
            style={{ width: '100%' }}
          >
            {label}
          </Button>
        }
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          {children}
        </div>

        {actions && (
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              paddingTop: '1rem',
              marginTop: '0.5rem',
              borderTop: '1px solid var(--color-border-light)',
            }}
            onClick={() => setOpen(false)}
          >
            {actions}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
