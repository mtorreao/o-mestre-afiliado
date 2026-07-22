/**
 * DashboardPage — Dashboard usando design system
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { Card, Button, Badge, DashboardSkeleton } from '../components/ui/index.ts';

interface ProfileData {
  id: number; email: string; name: string; shopeeConfigured: boolean; shopeeAppId: string | null;
  mercadoLivre: { connected: false } | { connected: true; nickname: string; mlUserId: string; expired: boolean; hasSessionCookies: boolean; meliid: string | null; melitat: string | null };
  sourceGroups?: { jid: string; name: string }[]; targetGroups?: { jid: string; name: string }[];
  excludedGroups?: { groupJid: string; groupName: string; reason: string; ratio: number; totalMessages: number; validOffers: number }[];
  messageTemplate?: string | null;
}

interface DashboardPageProps { user: { id: number; email: string; name: string }; token: string; }

export function DashboardPage({ user, token }: DashboardPageProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const loadProfile = useCallback(async () => {
    try { const r = await fetch('/api/affiliate/profile', { headers: { Authorization: `Bearer ${token}` } }); const d = await r.json() as { success: boolean; profile: ProfileData }; if (d.success) setProfile(d.profile); } catch {}
    setLoading(false);
  }, [token]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  if (loading) return <PageLayout><DashboardSkeleton /></PageLayout>;

  const ml = profile?.mercadoLivre?.connected === true ? profile.mercadoLivre as Exclude<ProfileData['mercadoLivre'], { connected: false }> : null;

  return (
    <PageLayout maxWidth="720px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Shopee */}
        <Card title="🛒 Shopee" subtitle="Credenciais da API Shopee" action={<Badge variant={profile?.shopeeConfigured ? 'success' : 'neutral'}>{profile?.shopeeConfigured ? '✅ Configurado' : '⚪ Não configurado'}</Badge>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <input type="text" placeholder="App ID (opcional)" defaultValue={profile?.shopeeAppId || ''}
              style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', outline: 'none', boxSizing: 'border-box' }} />
            <input type="password" placeholder="App Secret"
              style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </Card>

        {/* Mercado Livre */}
        {ml ? (
          <Card title="📦 Mercado Livre" subtitle={`Conectado como ${ml.nickname}${ml.expired ? ' (token expirado)' : ''}`} action={<Badge variant="success">✅ Conectado</Badge>}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Configuração do Mercado Livre</p>
          </Card>
        ) : (
          <Card title="📦 Mercado Livre" action={<Badge variant="neutral">❌ Não conectado</Badge>}>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>Conecte sua conta do Mercado Livre para gerar links de afiliado.</p>
            <Button variant="outline" size="sm" onClick={() => { window.location.href = `/api/ml/auth?userId=${user.id}`; }}>+ Conectar conta ML</Button>
          </Card>
        )}

        {/* Test Conversion */}
        <Card title="🧪 Testar Conversão">
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <input type="url" placeholder="Cole a URL do produto (Shopee ou ML)..."
              style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text-primary)', outline: 'none', boxSizing: 'border-box' }} />
            <Button disabled>Testar</Button>
          </div>
        </Card>
      </div>
    </PageLayout>
  );
}
