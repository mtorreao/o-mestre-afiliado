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

type Page = 'login' | 'register';

function App() {
  const { user, token, loading, isAuthenticated, login, register, logout } = useAuth();
  const [page, setPage] = useState<Page>('login');

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

  // Se autenticado, mostra dashboard
  if (isAuthenticated && user && token) {
    return <AffiliateDashboard user={user} token={token} onLogout={logout} />;
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
