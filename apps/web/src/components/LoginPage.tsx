/**
 * Tela de Login
 */

import { useState } from 'react';

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onSwitchToRegister: () => void;
}

export function LoginPage({ onLogin, onSwitchToRegister }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await onLogin(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem 1rem',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '400px',
        background: '#1e293b',
        borderRadius: '16px',
        border: '1px solid #334155',
        padding: '2rem',
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/logos/logo_full_square.png"
            alt="O Mestre Afiliado"
            style={{ width: '80px', height: '80px', marginBottom: '0.5rem' }}
          />
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>O Mestre Afiliado</h1>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>Faça login para continuar</p>
        </div>

        {error && (
          <div style={{
            padding: '0.75rem 1rem',
            background: '#7f1d1d',
            borderRadius: '8px',
            border: '1px solid #991b1b',
            color: '#fca5a5',
            fontSize: '0.9rem',
            marginBottom: '1rem',
          }}>
            ❌ {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              placeholder="seu@email.com"
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
              placeholder="Sua senha"
              required
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.9rem',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '0.75rem',
              borderRadius: '8px',
              border: 'none',
              background: loading ? '#6366f180' : '#6366f1',
              color: 'white',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginBottom: '1rem',
            }}
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: '0.9rem', color: '#94a3b8' }}>
          Não tem conta?{' '}
          <button
            onClick={onSwitchToRegister}
            style={{
              background: 'none',
              border: 'none',
              color: '#6366f1',
              cursor: 'pointer',
              fontSize: '0.9rem',
              fontWeight: 600,
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            Criar conta
          </button>
        </div>
      </div>
    </div>
  );
}
