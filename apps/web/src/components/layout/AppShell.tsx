/**
 * AppShell — Layout com sidebar para usuários autenticados
 */
import React, { useState } from 'react';
import { LayoutDashboard, ScrollText, Activity, LogOut, Menu, X, ChevronRight } from 'lucide-react';

export type NavItem = 'dashboard' | 'mirror-logs' | 'worker-status';

interface AppShellProps {
  currentNav: NavItem;
  onNavigate: (item: NavItem) => void;
  onLogout: () => void;
  userName: string;
  children: React.ReactNode;
}

export function AppShell({ currentNav, onNavigate, onLogout, userName, children }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const navItems: { id: NavItem; label: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    { id: 'mirror-logs', label: 'Espelhamento', icon: <ScrollText size={18} /> },
    { id: 'worker-status', label: 'Worker', icon: <Activity size={18} /> },
  ];

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
          style={{ display: 'none' }}
        />
      )}

      {/* Sidebar */}
      <aside
        className="app-sidebar"
        style={{
          width: '260px',
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          zIndex: 50,
          transition: 'transform var(--transition-base)',
        }}
      >
        {/* Logo + User */}
        <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--color-border-light)', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <img src="/logos/logo_full_square.png" alt="O Mestre Afiliado" style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-md)' }} />
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>O Mestre Afiliado</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{userName}</div>
          </div>
        </div>

        {/* Navigation */}
        <nav style={{ flex: 1, padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
          {navItems.map((item) => {
            const isActive = currentNav === item.id;
            return (
              <button key={item.id} onClick={() => onNavigate(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.625rem',
                  padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
                  border: 'none', width: '100%', textAlign: 'left',
                  background: isActive ? 'var(--color-primary-subtle)' : 'transparent',
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  fontSize: 'var(--text-sm)', fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer', transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                {item.icon}
                <span>{item.label}</span>
                {isActive && <ChevronRight size={14} style={{ marginLeft: 'auto' }} />}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--color-border-light)' }}>
          <button onClick={onLogout}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.5rem',
              padding: '0.5rem 0.75rem', borderRadius: 'var(--radius-md)',
              border: 'none', background: 'transparent', width: '100%', textAlign: 'left',
              color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', cursor: 'pointer',
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-error-subtle)'; e.currentTarget.style.color = 'var(--color-error)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-muted)'; }}
          >
            <LogOut size={18} /> <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="app-main" style={{ flex: 1, marginLeft: '260px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {/* Mobile top bar */}
        <div className="mobile-topbar" style={{ display: 'none', padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{ background: 'transparent', border: 'none', color: 'var(--color-text-primary)', cursor: 'pointer', padding: '0.25rem', display: 'flex' }}>
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>O Mestre Afiliado</span>
          <div style={{ width: '20px' }} />
        </div>
        {children}
      </main>

      <style>{`
        @media (max-width: 768px) {
          .app-sidebar { transform: translateX(-100%); }
          .app-sidebar.open { transform: translateX(0); }
          .sidebar-overlay {
            display: block !important;
            position: fixed; inset: 0; background: rgba(0,0,0,0.3); z-index: 40;
          }
          .app-main { margin-left: 0 !important; }
          .mobile-topbar { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
