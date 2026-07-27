import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth.ts';
import { Card } from '../components/ui/Card.tsx';
import { Switch } from '../components/ui/Switch.tsx';
import { Badge } from '../components/ui/Badge.tsx';

interface FlagData {
  key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  danger: boolean;
  checksLastHour: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export function FeatureFlagsPage() {
  const { token, isAdmin } = useAuth();
  const [flags, setFlags] = useState<FlagData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const res = await fetch(`/api/admin/feature-flags`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json() as { success: boolean; flags?: FlagData[]; error?: string };
    if (data.success && data.flags) {
      setFlags(data.flags);
    } else {
      setError(data.error ?? 'Erro ao carregar flags');
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    if (!isAdmin) return;
    loadFlags();
  }, [isAdmin, loadFlags]);

  const toggleFlag = async (key: string, currentEnabled: boolean) => {
    const flag = flags.find((f) => f.key === key);
    if (!flag) return;

    if (flag.danger) {
      const msg = currentEnabled
        ? `Desativar "${flag.label}"?`
        : `Ativar "${flag.label}"?\n\n${flag.description}`;
      if (!window.confirm(msg)) return;
    }

    setToggling(key);
    const res = await fetch(`/api/admin/feature-flags/${key}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ enabled: !currentEnabled }),
    });
    const data = await res.json() as { success: boolean; error?: string };
    if (data.success) {
      await loadFlags();
    } else {
      alert(`Erro: ${data.error}`);
    }
    setToggling(null);
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: 'var(--spacing-6)' }}>
        <p>Acesso restrito ao administrador.</p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 'var(--spacing-6)' }}>Carregando...</div>;
  }

  if (error) {
    return <div style={{ padding: 'var(--spacing-6)', color: 'var(--color-error)' }}>{error}</div>;
  }

  return (
    <div style={{ padding: 'var(--spacing-6)', maxWidth: '720px' }}>
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: 'var(--spacing-4)' }}>
        Feature Flags
      </h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 'var(--spacing-6)' }}>
        Gerencie as flags de funcionalidade do sistema. Alterações propagam em segundos.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
        {flags.map((flag) => (
          <Card key={flag.key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--spacing-4)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: 0 }}>{flag.label}</h3>
                  <Badge variant={flag.enabled ? 'success' : 'neutral'}>
                    {flag.enabled ? 'Ativa' : 'Inativa'}
                  </Badge>
                </div>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: '0 0 0.5rem 0' }}>
                  {flag.description}
                </p>
                <div style={{ display: 'flex', gap: '1rem', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                  <span>Consultas (1h): {flag.checksLastHour}</span>
                  {flag.updatedBy && (
                    <span>Alterado por {flag.updatedBy}</span>
                  )}
                  {flag.updatedAt && (
                    <span>{new Date(flag.updatedAt).toLocaleString('pt-BR')}</span>
                  )}
                  {!flag.updatedBy && <span>(padrão)</span>}
                </div>
              </div>
              <Switch
                checked={flag.enabled}
                disabled={toggling === flag.key}
                onCheckedChange={() => toggleFlag(flag.key, flag.enabled)}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
