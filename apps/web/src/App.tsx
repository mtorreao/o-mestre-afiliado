/**
 * O Mestre Afiliado — Web App
 *
 * Com autenticação: Login → Dashboard do Afiliado
 * Design system: Radix UI + Lucide + Tema light minimalista
 */
import { useState } from 'react';
import { useAuth } from './hooks/useAuth.ts';
import { ThemeProvider } from './hooks/useTheme.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { RegisterPage } from './pages/RegisterPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { MirrorLogsPage } from './pages/MirrorLogsPage.tsx';
import { WorkerStatusPage } from './pages/WorkerStatusPage.tsx';
import { GroupsPage } from './pages/GroupsPage.tsx';
import { AppShell, type NavItem } from './components/layout/AppShell.tsx';
import { ToastProvider } from './components/ui/index.ts';
import { ThemeToggle } from './components/ui/ThemeToggle.tsx';
import { Loader2 } from 'lucide-react';

type AuthPage = 'login' | 'register';

const pageTitles: Record<NavItem, string> = {
  dashboard: 'Dashboard',
  settings: 'Configurações',
  groups: 'Grupos',
  'mirror-logs': 'Espelhamento',
  'worker-status': 'Status do Worker',
};

function AppContent() {
  const { user, token, loading, isAuthenticated, login, register, logout } = useAuth();
  const [authPage, setAuthPage] = useState<AuthPage>('login');
  const [nav, setNav] = useState<NavItem>('dashboard');

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: '1rem',
          background: 'var(--color-bg)',
        }}
      >
        <Loader2 size={32} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--color-primary)' }} />
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>Carregando...</span>
      </div>
    );
  }

  // Authenticated — AppShell + Pages
  if (isAuthenticated && user && token) {
    return (
      <ToastProvider>
        <AppShell
          currentNav={nav}
          onNavigate={setNav}
          onLogout={() => {
            logout();
            setNav('dashboard');
          }}
          userName={user.name}
          pageTitle={pageTitles[nav]}
        >
          {nav === 'settings' && (
            <SettingsPage user={user} token={token} />
          )}
          {nav === 'groups' && (
            <GroupsPage token={token} />
          )}
          {nav === 'mirror-logs' && (
            <MirrorLogsPage token={token} onBack={() => setNav('dashboard')} />
          )}
          {nav === 'settings' && (
            <SettingsPage user={user} token={token} />
          )}
          {nav === 'worker-status' && (
            <WorkerStatusPage onBack={() => setNav('dashboard')} />
          )}
          {nav === 'dashboard' && (
            <DashboardPage user={user} token={token} onNavigate={setNav} />
          )}
        </AppShell>
      </ToastProvider>
    );
  }

  // Unauthenticated — Login or Register
  return (
    <ToastProvider>
      {/* Floating theme toggle for auth pages */}
      <div style={{ position: 'fixed', top: '1rem', right: '1rem', zIndex: 60 }}>
        <ThemeToggle />
      </div>
      {authPage === 'register' ? (
        <RegisterPage
          onRegister={async (name, email, password) => {
            await register(name, email, password);
          }}
          onSwitchToLogin={() => setAuthPage('login')}
        />
      ) : (
        <LoginPage
          onLogin={async (email, password) => {
            await login(email, password);
          }}
          onSwitchToRegister={() => setAuthPage('register')}
        />
      )}
    </ToastProvider>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
