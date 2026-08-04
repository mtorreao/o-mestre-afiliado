import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@omestre/ui';
import { login } from '../lib/api.ts';

interface Props {
  onLogin: () => void;
}

export default function LoginPage({ onLogin }: Props) {
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(user.trim(), password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falha no login');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-wrap">
      <Card className="login-card">
        <div className="login-logo">⚙️ Admin Center</div>
        <div className="login-sub">O Mestre Afiliado — painel administrativo</div>

        <form onSubmit={handleSubmit}>
          <Input
            label="Usuário"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            autoComplete="username"
            required
          />

          <div style={{ marginTop: 14 }}>
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <div className="status-line status-error">
              <span>⚠️</span> {error}
            </div>
          )}

          <Button
            variant="primary"
            type="submit"
            loading={loading}
            style={{ width: '100%', marginTop: 16 }}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
