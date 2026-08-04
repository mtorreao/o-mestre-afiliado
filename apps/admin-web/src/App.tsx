import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { checkSession } from './lib/api.ts';
import LoginPage from './pages/LoginPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import DeployDetailPage from './pages/DeployDetailPage.tsx';

export default function App() {
  const [authState, setAuthState] = useState<'loading' | 'authed' | 'guest'>('loading');

  useEffect(() => {
    checkSession().then((ok) => setAuthState(ok ? 'authed' : 'guest'));
  }, []);

  // Callback centralizada: chamada pelo LoginPage no sucesso e pelo
  // DashboardPage no logout. Garante que qualquer mudança de auth reflita
  // imediatamente no guard de rota, sem depender de reload.
  const handleAuthChange = (state: 'authed' | 'guest') => setAuthState(state);

  if (authState === 'loading') {
    return (
      <div className="login-wrap">
        <div className="card login-card" style={{ textAlign: 'center' }}>
          <div className="login-logo">⚙️ Admin Center</div>
          <div className="muted">Verificando sessão…</div>
        </div>
      </div>
    );
  }

  if (authState === 'guest') {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage onLogin={() => handleAuthChange('authed')} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<DashboardPage onLogout={() => handleAuthChange('guest')} />} />
      <Route path="/deploys/:id" element={<DeployDetailPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
