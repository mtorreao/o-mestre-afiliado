/**
 * FilterBar — Container reutilizável para barras de filtro
 *
 * Layout flex com wrapping, gap padronizado e items que não encolhem.
 * Cada filtro deve ser envolvido em <FilterBar.Item> com as props de largura.
 *
 * Uso básico (sempre visível):
 *   <FilterBar>
 *     <FilterBar.Item width="150px">
 *       <Select label="Status" ... />
 *     </FilterBar.Item>
 *   </FilterBar>
 *
 * Uso collapsível (recolhe em mobile, abre BottomSheet):
 *   <FilterBar collapsible actions={<><Button>Filtrar</Button></>}>
 *     <FilterBar.Item width="150px">
 *       <Select ... />
 *     </FilterBar.Item>
 *   </FilterBar>
 */
import React from 'react';
import { Filter } from 'lucide-react';
import { Card } from './Card.tsx';
import { Button } from './Button.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';

// ─── Context para modo mobile ──────────────────────────

const FilterBarContext = React.createContext<{ isMobile: boolean }>({ isMobile: false });

// ─── FilterBar (container) ─────────────────────────────

interface FilterBarProps {
  children: React.ReactNode;
  /** Quando true, recolhe em mobile (<768px) e abre via BottomSheet */
  collapsible?: boolean;
  /** Rótulo do botão de abrir filtros em modo collapsible */
  label?: string;
  /** Ações que aparecem no rodapé do BottomSheet (mobile) ou ao lado (desktop) */
  actions?: React.ReactNode;
}

export function FilterBar({ children, collapsible = false, label = 'Filtros', actions }: FilterBarProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [sheetOpen, setSheetOpen] = React.useState(false);

  // Modo collapsível + mobile: renderiza apenas o trigger + BottomSheet
  if (collapsible && isMobile) {
    return (
      <FilterBarContext.Provider value={{ isMobile: true }}>
        <BottomSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={label}
          trigger={
            <Button
              variant="outline"
              onClick={() => setSheetOpen(true)}
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

          {/* Actions no rodapé */}
          {actions && (
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'flex-end',
                paddingTop: '1rem',
                marginTop: '0.5rem',
                borderTop: '1px solid var(--color-border-light)',
              }}
            >
              {actions}
            </div>
          )}
        </BottomSheet>
      </FilterBarContext.Provider>
    );
  }

  // Desktop ou não collapsível: render normal com Card
  return (
    <Card>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'flex-end',
        }}
      >
        {children}
        {actions && (
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: 'auto' }}>
            {actions}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─── FilterBar.Item (cada campo) ───────────────────────

interface FilterBarItemProps {
  children: React.ReactNode;
  /** Largura base do item (flex-basis). Padrão: '150px' */
  width?: string;
  /** Fator de crescimento (flex-grow). 0 = não cresce, 1 = cresce. Padrão: 0 */
  grow?: number;
}

function FilterBarItem({ children, width = '150px', grow = 0 }: FilterBarItemProps) {
  const { isMobile } = React.useContext(FilterBarContext);

  // Mobile: full width, sem restrições de altura
  if (isMobile) {
    return <div style={{ width: '100%' }}>{children}</div>;
  }

  // Desktop: flex item com as props de largura
  return (
    <div
      style={{
        flex: `${grow} 0 ${width}`,
        minWidth: 0,
        maxWidth: grow > 0 ? undefined : width,
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

FilterBar.Item = FilterBarItem;
