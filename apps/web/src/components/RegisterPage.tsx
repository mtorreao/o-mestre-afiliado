/**
 * Tela de Registro
 */

import { useState } from 'react';

interface RegisterPageProps {
  onRegister: (name: string, email: string, password: string) => Promise<void>;
  onSwitchToLogin: () => void;
}

export function RegisterPage({ onRegister, onSwitchToLogin }: RegisterPageProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (password !== confirmPassword) {
      setError('Senhas não conferem');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('Senha deve ter pelo menos 6 caracteres');
      setLoading(false);
      return;
    }

    try {
      await onRegister(name, email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar conta');
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
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem' }}>Criar Conta</h1>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>
            Junte-se ao O Mestre Afiliado
          </p>
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
              Nome
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName((e.target as HTMLInputElement).value)}
              placeholder="Seu nome"
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

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
              Senha
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
              placeholder="Mínimo 6 caracteres"
              required
              minLength={6}
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
              Confirmar Senha
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword((e.target as HTMLInputElement).value)}
              placeholder="Repita a senha"
              required
              minLength={6}
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
            {loading ? 'Criando...' : 'Criar Conta'}
          </button>
        </form>

        <div style={{ textAlign: 'center', fontSize: '0.9rem', color: '#94a3b8' }}>
          Já tem conta?{' '}
          <button
            onClick={onSwitchToLogin}
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
            Fazer login
          </button>
        </div>
      </div>
    </div>
  );
}
