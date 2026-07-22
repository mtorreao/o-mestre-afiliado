/**
 * AppShell — Layout responsivo para usuários autenticados
 *
 * Estrutura:
 *   - Desktop (≥768px): Sidebar fixa 260px + (Topbar 56px + Main content)
 *   - Mobile  (<768px): Drawer overlay + Topbar + Main content
 *
 * Transições CSS definidas em globals.css (classes sidebar-overlay,
 * sidebar-drawer, etc.) em vez de estilos inline.
 */
import { ThemeToggle } from './../ui/ThemeToggle.tsx';
import React, { useState } from 'react';
import {
  LayoutDashboard,
  Repeat2,
  Activity,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  GitFork,
} from 'lucide-react';

export type NavItem = 'dashboard' | 'settings' | 'groups' | 'mirrors' | 'mirror-logs' | 'mirror-form' | 'worker-status';

interface AppShellProps {
  currentNav: NavItem;
  onNavigate: (item: NavItem) => void;
  onLogout: () => void;
  userName: string;
  pageTitle?: string;
  children: React.ReactNode;
}

export function AppShell({ currentNav, onNavigate, onLogout, userName, pageTitle = '', children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'mirrors', label: 'Espelhamentos', icon: <GitFork size={18} /> },
    { id: 'settings', label: 'Configurações', icon: <Settings size={18} /> },
    { id: 'groups', label: 'Grupos', icon: <Users size={18} /> },
    { id: 'mirror-logs', label: 'Logs de espelhamento', icon: <Repeat2 size={18} /> },
    { id: 'worker-status', label: 'Worker', icon: <Activity size={18} /> },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* Mobile overlay */}
      <div
        onClick={() => setSidebarOpen(false)}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 40,
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? ('auto' as const) : ('none' as const),
          transition: 'opacity var(--transition-base)',
        }}
      />

      {/* Sidebar / Mobile drawer — slide via CSS */}
      <aside className={`sidebar-drawer${sidebarOpen ? ' open' : ''}`}>
        {/* Logo + brand no topo */}
        <div className="sidebar-header">
          <img
            src="/logos/logo_full_square.png"
            alt="O Mestre Afiliado"
            className="sidebar-logo-img"
          />
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">O Mestre Afiliado</span>
          </div>
        </div>

        {/* Navegação — padding 0.75rem vertical (≥ 44px total) */}
        <nav className="sidebar-nav">
          {navItems.map((item) => {
            const isActive = currentNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  setSidebarOpen(false);
                }}
                className={`sidebar-nav-item${isActive ? ' active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
                {isActive && <ChevronRight size={14} className="sidebar-nav-chevron" />}
              </button>
            );
          })}
        </nav>

        {/* Footer: nome do usuário + Sair */}
        <div className="sidebar-footer">
          <span className="sidebar-username">{userName}</span>
          <button onClick={onLogout} className="sidebar-footer-btn">
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main content: topbar + children */}
      <div className="app-main-area">
        {/* Topbar — sempre visível, altura fixa 56px */}
        <header className="topbar">
          {/* Hamburger — 44×44px touch target */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Nome da página centralizado (mobile) / alinhado à esquerda (desktop) */}
          <span className="topbar-title">{pageTitle}</span>

          {/* Theme toggle */}
          <ThemeToggle />
        </header>

        {/* Page content */}
        {children}

      {/* Inline styles for responsive layout */}
      <style>{`
        @media (max-width: 768px) {
          .main-content {
            margin-left: 0 !important;
          }
          .mobile-topbar {
            display: flex !important;
          }
        }
      `}</style>
    </div>
    </div>
  );
}
