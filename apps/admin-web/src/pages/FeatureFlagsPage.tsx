/**
 * Feature Flags — versão port para admin-web.
 *
 * Diferenças em relação ao apps/web/src/pages/FeatureFlagsPage.tsx:
 *   - Remove dependência de `useAuth` (do apps/web, baseado em JWT + isAdmin).
 *   - Usa `getToken()` direto de `lib/api.ts` (admin-api é single-user,
 *     sessão já validada pelo `App.tsx` antes de chegar aqui).
 *   - Remove o gate `if (!isAdmin) return ...` — admin-web já garante sessão.
 *
 * Comportamento: idêntico ao da versão web (lista flags, toggle com
 * confirmação para flags perigosas, token via getToken).
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Switch, Badge } from '@omestre/ui';
import { getToken, listFlags, toggleFlag, type FlagData } from '../lib/api.ts';

export function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FlagData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    try {
      setFlags(await listFlags());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar flags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFlags();
  }, [loadFlags]);

  const handleToggle = async (key: string, currentEnabled: boolean) => {
    const flag = flags.find((f) => f.key === key);
    if (!flag) return;

    if (flag.danger) {
      const msg = currentEnabled
        ? `Desativar "${flag.label}"?`
        : `Ativar "${flag.label}"?\n\n${flag.description}`;
      if (!window.confirm(msg)) return;
    }

    setToggling(key);
    try {
      await toggleFlag(key, !currentEnabled);
      await loadFlags();
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : 'falha ao atualizar flag'}`);
    } finally {
      setToggling(null);
    }
  };

  // Garante que o token está presente (a rota /login já bloqueia guest antes,
  // mas o helper pode ser usado fora do contexto autenticado em testes/dev).
  if (!getToken() && !loading) {
    return (
      <div style={{ padding: 'var(--spacing-6)' }}>
        <p>Sessão expirada — faça login novamente.</p>
      </div>
    );
  }

  if (loading) {
    return <div style={{ padding: 'var(--spacing-6)' }}>Carregando…</div>;
  }

  if (error) {
    return <div style={{ padding: 'var(--spacing-6)', color: 'var(--color-error)' }}>{error}</div>;
  }

  return (
    <div style={{ padding: 'var(--spacing-6)', maxWidth: '720px' }}>
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 700,
          marginBottom: 'var(--spacing-4)',
        }}
      >
        Feature Flags
      </h1>
      <p
        style={{
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--spacing-6)',
        }}
      >
        Gerencie as flags de funcionalidade do sistema. Alterações propagam em segundos.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
        {flags.map((flag) => (
          <Card key={flag.key}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'var(--spacing-4)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.25rem',
                  }}
                >
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, margin: 0 }}>
                    {flag.label}
                  </h3>
                  <Badge variant={flag.enabled ? 'success' : 'neutral'}>
                    {flag.enabled ? 'Ativa' : 'Inativa'}
                  </Badge>
                </div>
                <p
                  style={{
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-secondary)',
                    margin: '0 0 0.5rem 0',
                  }}
                >
                  {flag.description}
                </p>
                <div
                  style={{
                    display: 'flex',
                    gap: '1rem',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-tertiary)',
                  }}
                >
                  <span>Consultas (1h): {flag.checksLastHour}</span>
                  {flag.updatedBy && <span>Alterado por {flag.updatedBy}</span>}
                  {flag.updatedAt && (
                    <span>{new Date(flag.updatedAt).toLocaleString('pt-BR')}</span>
                  )}
                  {!flag.updatedBy && <span>(padrão)</span>}
                </div>
              </div>
              <Switch
                checked={flag.enabled}
                disabled={toggling === flag.key}
                onCheckedChange={() => handleToggle(flag.key, flag.enabled)}
              />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default FeatureFlagsPage;
