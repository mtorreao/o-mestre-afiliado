/**
 * O Mestre Afiliado — Web App
 *
 * Com autenticação: Login → Dashboard do Afiliado
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './hooks/useAuth.ts';
import { LoginPage } from './components/LoginPage.tsx';
import { RegisterPage } from './components/RegisterPage.tsx';
import { AffiliateDashboard } from './components/AffiliateDashboard.tsx';
import { MirrorLogs } from './components/MirrorLogs.tsx';
import { WorkerStatus } from './components/WorkerStatus.tsx';

type Page = 'login' | 'register';

function App() {
  const { user, token, loading, isAuthenticated, login, register, logout } = useAuth();
  const [page, setPage] = useState<Page>('login');
  const [subPage, setSubPage] = useState<'dashboard' | 'mirror-logs' | 'worker-status'>('dashboard');

  // Se estiver carregando (verificando token), mostra loading
  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        background: '#0f172a',
        color: '#e2e8f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        Carregando...
      </div>
    );
  }

  // Se autenticado, mostra dashboard, logs ou worker status
  if (isAuthenticated && user && token) {
    if (subPage === 'mirror-logs') {
      return <MirrorLogs token={token} onBack={() => setSubPage('dashboard')} />;
    }
    if (subPage === 'worker-status') {
      return <WorkerStatus onBack={() => setSubPage('dashboard')} />;
    }
    return <AffiliateDashboard user={user} token={token} onLogout={logout} onNavigateToLogs={() => setSubPage('mirror-logs')} onNavigateToWorkerStatus={() => setSubPage('worker-status')} />;
  }

  // Se não autenticado, mostra login ou registro
  if (page === 'register') {
    return (
      <RegisterPage
        onRegister={async (name, email, password) => {
          await register(name, email, password);
        }}
        onSwitchToLogin={() => setPage('login')}
      />
    );
  }

  return (
    <LoginPage
      onLogin={async (email, password) => {
        await login(email, password);
      }}
      onSwitchToRegister={() => setPage('register')}
    />
  );
}

export default App;
