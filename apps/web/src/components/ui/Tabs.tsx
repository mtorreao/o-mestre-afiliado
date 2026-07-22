/**
 * Tabs — Navegação por abas via Radix Tabs
 */
import React from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import clsx from 'clsx';

interface Tab {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface TabsProps {
  tabs: Tab[];
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  className?: string;
}

export function Tabs({ tabs, value, onValueChange, children, className }: TabsProps) {
  const contentStyle: React.CSSProperties = {
    marginTop: '1rem',
    outline: 'none',
  };

  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange} className={clsx('Tabs', className)}>
      <RadixTabs.List className="TabsList" aria-label="Navegação por abas">
        {tabs.map((tab) => (
          <RadixTabs.Trigger key={tab.value} value={tab.value} className="TabsTrigger">
            {tab.icon && <span style={{ display: 'inline-flex', marginRight: '0.35rem' }}>{tab.icon}</span>}
            {tab.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {React.Children.map(children, (child, i) => (
        <RadixTabs.Content key={tabs[i]?.value ?? i} value={tabs[i]?.value ?? ''} style={contentStyle}>
          {child}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
