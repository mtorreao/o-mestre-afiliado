/**
 * AppShell — Layout responsivo para usuários autenticados
 *
 * Estrutura: Sidebar esquerda + (Topbar + conteúdo principal via <Outlet />)
 *
 * Agora integrado com React Router: navegação via <NavLink /> e useNavigate.
 */
import { ThemeToggle } from './../ui/ThemeToggle.tsx';
import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Repeat2,
  Activity,
  Settings,
  Users,
  LogOut,
  Menu,
  X,
  ChevronRight,
  GitFork,
} from 'lucide-react';

export type NavItem = 'dashboard' | 'settings' | 'groups' | 'mirrors' | 'mirror-logs' | 'mirror-form' | 'worker-status';

interface AppShellLayoutProps {
  userName: string;
  onLogout: () => void;
}

/** Mapeia o pathname atual para um NavItem */
function pathToNav(pathname: string): NavItem {
  const path = pathname.replace(/^\//, '') || 'dashboard';
  if (['dashboard', 'settings', 'groups', 'mirror-logs', 'worker-status'].includes(path)) {
    return path as NavItem;
  }
  return 'dashboard';
}

const pageTitles: Record<NavItem, string> = {
  dashboard: 'Dashboard',
  settings: 'Configurações',
  groups: 'Grupos de Espelhamento',
  mirrors: 'Espelhamentos',
  'mirror-logs': 'Logs de Espelhamento',
  'mirror-form': 'Novo Espelhamento',
  'worker-status': 'Status do Worker',
};

export function AppShellLayout({ userName, onLogout }: AppShellLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const currentNav = pathToNav(location.pathname);

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'mirrors', label: 'Espelhamentos', icon: <GitFork size={18} /> },
    { id: 'settings', label: 'Configurações', icon: <Settings size={18} /> },
    { id: 'groups', label: 'Grupos', icon: <Users size={18} /> },
    { id: 'mirror-logs', label: 'Logs de espelhamento', icon: <Repeat2 size={18} /> },
    { id: 'worker-status', label: 'Worker', icon: <Activity size={18} /> },
  ];

  function handleNavigate(id: NavItem) {
    const path = id === 'dashboard' ? '/' : `/${id}`;
    navigate(path);
    setSidebarOpen(false);
  }

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
                onClick={() => handleNavigate(item.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: 'var(--spacing-2) var(--spacing-3)',
                  borderRadius: 'var(--radius-md)',
                  border: 'none',
                  background: isActive ? 'var(--color-primary-subtle)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                  textAlign: 'left',
                  width: '100%',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-primary-subtle)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
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

      {/* Main area: topbar + Outlet */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: 'column', marginLeft: '260px' }}
        className="main-content"
      >
        {/* Topbar — always visible */}
        <div
          className="topbar"
          style={{
            display: 'flex',
            padding: 'var(--spacing-3) var(--spacing-4)',
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
          }}
        >
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

          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {pageTitles[currentNav]}
          </span>

          {/* Theme toggle */}
          <ThemeToggle />
        </div>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Outlet />
        </main>

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
