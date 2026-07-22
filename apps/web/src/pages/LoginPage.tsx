/**
 * LoginPage — Tela de login refatorada com novo design system
 */
import { useState } from 'react';
import { Button, Input } from '../components/ui/index.ts';
import { LogIn } from 'lucide-react';

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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1rem',
        background: 'linear-gradient(135deg, #fafafa 0%, #f0f0f5 100%)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '400px',
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-2xl)',
          border: '1px solid var(--color-border)',
          padding: '2.5rem 2rem',
          boxShadow: 'var(--shadow-lg)',
          animation: 'fadeInUp var(--transition-slow)',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img
            src="/logos/logo_full_square.png"
            alt="O Mestre Afiliado"
            style={{ width: '72px', height: '72px', marginBottom: '1rem', borderRadius: 'var(--radius-xl)' }}
          />
          <h1 style={{ margin: '0 0 0.25rem', fontSize: '1.5rem', fontWeight: 700 }}>O Mestre Afiliado</h1>
          <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
            Faça login para continuar
          </p>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '0.75rem 1rem',
              background: 'var(--color-error-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-error)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
              marginBottom: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>⚠️</span> {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
            placeholder="seu@email.com"
            required
          />
          <Input
            label="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword((e.target as HTMLInputElement).value)}
            placeholder="Sua senha"
            required
          />
          <Button
            type="submit"
            loading={loading}
            size="lg"
            icon={<LogIn size={18} />}
            style={{ marginTop: '0.5rem', width: '100%' }}
          >
            Entrar
          </Button>
        </form>

        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          Não tem conta?{' '}
          <button
            onClick={onSwitchToRegister}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-primary)',
              cursor: 'pointer',
              fontSize: 'var(--text-sm)',
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
