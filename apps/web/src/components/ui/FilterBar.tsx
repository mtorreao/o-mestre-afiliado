/**
 * FilterBar — Container para barras de filtro (desktop)
 *
 * Layout flex com wrapping, gap padronizado e items que não encolhem.
 * Cada filtro deve ser envolvido em <FilterBar.Item> com as props de largura.
 *
 * Uso:
 *   <FilterBar title="Filtros">
 *     <FilterBar.Item width="150px">
 *       <Select label="Status" ... />
 *     </FilterBar.Item>
 *     <FilterBar.Item width="200px" grow={2}>
 *       <input type="text" placeholder="Buscar..." />
 *     </FilterBar.Item>
 *   </FilterBar>
 */
import React from 'react';
import { Card } from './Card.tsx';

// ─── FilterBar (container) ─────────────────────────────

interface FilterBarProps {
  children: React.ReactNode;
  /** Título opcional do card (mostrado no header à esquerda) */
  title?: string;
  /** Ação no header, alinhada à direita (ex: botão Limpar) */
  action?: React.ReactNode;
}

export function FilterBar({ children, title, action }: FilterBarProps) {
  return (
    <Card title={title} action={action}>
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
