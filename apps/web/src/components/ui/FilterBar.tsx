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
 *   <FilterBar collapsible>
 *     <FilterBar.Item width="150px">
 *       <Select ... />
 *     </FilterBar.Item>
 *   </FilterBar>
 */
import React, { useState } from 'react';
import { Filter } from 'lucide-react';
import { Card } from './Card.tsx';
import { Button } from './Button.tsx';
import { BottomSheet } from './BottomSheet.tsx';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';

// ─── FilterBar (container) ─────────────────────────────

interface FilterBarProps {
  children: React.ReactNode;
  /** Quando true, recolhe em mobile (<768px) e abre via BottomSheet */
  collapsible?: boolean;
  /** Rótulo do botão de abrir filtros em modo collapsible */
  label?: string;
}

export function FilterBar({ children, collapsible = false, label = 'Filtros' }: FilterBarProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [sheetOpen, setSheetOpen] = useState(false);

  // Modo collapsível + mobile: renderiza apenas o trigger + BottomSheet
  if (collapsible && isMobile) {
    return (
      <>
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
              gap: '1rem',
            }}
          >
            {children}
          </div>
        </BottomSheet>
      </>
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
