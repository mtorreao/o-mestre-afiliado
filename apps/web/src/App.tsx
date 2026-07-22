/**
 * O Mestre Afiliado — Web App
 *
 * Com autenticação: Login → Dashboard do Afiliado
 * Design system: Radix UI + Lucide + Tema light minimalista
 *
 * Rotas (React Router):
 *   /login          → LoginPage
 *   /register       → RegisterPage
 *   /               → DashboardPage (protegida)
 *   /settings       → SettingsPage (protegida)
 *   /groups         → GroupsPage (protegida)
 *   /mirror-logs    → MirrorLogsPage (protegida)
 *   /worker-status  → WorkerStatusPage (protegida)
 */
import { useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './hooks/useAuth.ts';
import { ThemeProvider } from './hooks/useTheme.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { RegisterPage } from './pages/RegisterPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';
import { AppShellLayout } from './components/layout/AppShell.tsx';
import { ToastProvider } from './components/ui/index.ts';
import { ThemeToggle } from './components/ui/ThemeToggle.tsx';
import { Loader2 } from 'lucide-react';

// ─── Protected route guard ──────────────────────────────

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();
  const location = useLocation();

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

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}

// ─── Auth-aware route redirect for login/register ────────

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg)',
        }}
      >
        <Loader2 size={32} style={{ animation: 'spin 0.8s linear infinite', color: 'var(--color-primary)' }} />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// ─── Main App ────────────────────────────────────────────

function App() {
  const { user, token, login, register, logout, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  return (
    <Routes>
      {/* Public routes — só visível quando deslogado */}
      <Route
        path="/login"
        element={
          <GuestRoute>
            <ToastProvider>
              <LoginPage
                onLogin={async (email, password) => {
                  await login(email, password);
                }}
                onSwitchToRegister={() => navigate('/register')}
              />
            </ToastProvider>
          </GuestRoute>
        }
      />
      <Route
        path="/register"
        element={
          <GuestRoute>
            <ToastProvider>
              <RegisterPage
                onRegister={async (name, email, password) => {
                  await register(name, email, password);
                }}
                onSwitchToLogin={() => navigate('/login')}
              />
            </ToastProvider>
          </GuestRoute>
        }
      />

      {/* Protected routes — AppShell com sidebar */}
      <Route
        element={
          <ProtectedRoute>
            <ToastProvider>
              <AppShellLayout
                userName={user?.name ?? ''}
                onLogout={() => {
                  logout();
                  navigate('/login');
                }}
              />
            </ToastProvider>
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage user={user!} token={token!} />} />
        <Route path="settings" element={<SettingsPage user={user!} token={token!} />} />
        <Route path="groups" element={<GroupsPage token={token!} />} />
        <Route path="mirror-logs" element={<MirrorLogsPage token={token!} />} />
        <Route path="worker-status" element={<WorkerStatusPage />} />
      </Route>

      {/* Catch-all → redirect to dashboard or login */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
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
