/**
 * AppShell — Layout principal para usuários autenticados
 *
 * Estrutura: Sidebar esquerda + (Topbar + conteúdo principal)
 */
import React, { useState } from 'react';
import {
  LayoutDashboard,
  Settings,
  ScrollText,
  Activity,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from 'lucide-react';

export type NavItem = 'dashboard' | 'settings' | 'mirror-logs' | 'worker-status';

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
    { id: 'settings', label: 'Configurações', icon: <Settings size={18} /> },
    { id: 'mirror-logs', label: 'Espelhamento', icon: <ScrollText size={18} /> },
    { id: 'worker-status', label: 'Worker', icon: <Activity size={18} /> },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.3)',
            zIndex: 40,
          }}
        />
      )}

      {/* Sidebar */}
      <aside
        style={{
          width: '260px',
          background: 'var(--color-surface)',
          boxShadow: 'var(--shadow-border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          zIndex: 50,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform var(--transition-base)',
        }}
        className="sidebar-desktop"
      >
        {/* Logo */}
        <div
          style={{
            padding: 'var(--spacing-5)',
            borderBottom: '1px solid var(--color-border-light)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
          }}
        >
          <img
            src="/logos/logo_full_square.png"
            alt="O Mestre Afiliado"
            style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)' }}
          />
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              O Mestre Afiliado
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              {userName}
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: 'var(--spacing-3)', display: 'flex', flexDirection: 'column', gap: 'var(--spacing-1)' }}>
          {navItems.map((item) => {
            const isActive = currentNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onNavigate(item.id);
                  setSidebarOpen(false);
                }}
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
                {isActive && <ChevronRight size={14} style={{ marginLeft: 'auto' }} />}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ padding: 'var(--spacing-3)', borderTop: '1px solid var(--color-border-light)' }}>
          <button
            onClick={onLogout}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-2)',
              padding: 'var(--spacing-2) var(--spacing-3)',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'transparent',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              width: '100%',
              textAlign: 'left',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--color-error-subtle)'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-error)'; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = 'var(--color-text-muted)'; }}
          >
            <LogOut size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main area: topbar + content */}
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
            className="hamburger-btn"
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
            aria-label={sidebarOpen ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          {pageTitle && (
            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {pageTitle}
            </span>
          )}

          <div style={{ width: '20px' }} />
        </div>

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {children}
        </main>
      </div>

      {/* Responsive styles */}
      <style>{`
        @media (max-width: 768px) {
          .sidebar-desktop {
            transform: translateX(-100%);
          }
          .sidebar-desktop.open {
            transform: translateX(0);
          }
          .main-content {
            margin-left: 0 !important;
          }
        }
        @media (min-width: 769px) {
          .sidebar-desktop {
            transform: translateX(0) !important;
          }
          .hamburger-btn {
            display: none !important;
          }
        }
      `}</style>
    </div>
  );
}
