/**
 * DashboardPage — Dashboard principal do afiliado
 *
 * Compõe todas as seções de configuração do dashboard.
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Loading } from '../components/ui/index.ts';
import { ShopeeConfigSection } from './sections/ShopeeConfigSection.tsx';
import { MlConfigSection } from './sections/MlConfigSection.tsx';
import { TestConversionSection } from './sections/TestConversionSection.tsx';
import { MirrorConfigSection } from './sections/MirrorConfigSection.tsx';
import { MessageTemplateSection } from './sections/MessageTemplateSection.tsx';
import { ExcludedGroupsSection } from './sections/ExcludedGroupsSection.tsx';
import { WppConnection } from '../components/WppConnection.tsx';

interface ProfileData {
  id: number;
  email: string;
  name: string;
  shopeeConfigured: boolean;
  shopeeAppId: string | null;
  mercadoLivre:
    | { connected: false }
    | { connected: true; nickname: string; mlUserId: string; expired: boolean; hasSessionCookies: boolean; meliid: string | null; melitat: string | null };
  sourceGroups?: { jid: string; name: string }[];
  targetGroups?: { jid: string; name: string }[];
  excludedGroups?: {
    groupJid: string;
    groupName: string;
    reason: string;
    ratio: number;
    totalMessages: number;
    validOffers: number;
  }[];
  messageTemplate?: string | null;
}

interface DashboardPageProps {
  user: { id: number; email: string; name: string };
  token: string;
}

export function DashboardPage({ user, token }: DashboardPageProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/affiliate/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { success: boolean; profile: ProfileData };
      if (data.success) {
        setProfile(data.profile);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  if (loading) {
    return (
      <PageLayout>
        <Loading text="Carregando perfil..." />
      </PageLayout>
    );
  }

  const mlConnected = profile?.mercadoLivre.connected === true;
  const ml = mlConnected ? (profile!.mercadoLivre as Exclude<ProfileData['mercadoLivre'], { connected: false }>) : null;

  return (
    <PageLayout maxWidth="720px">
      {/* ML Connect Button (always visible) */}
      {!mlConnected && (
        <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
            Conecte sua conta do Mercado Livre para gerar links de afiliado.
          </p>
        </div>
      )}

      {/* Cards grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {/* Shopee */}
        <ShopeeConfigSection
          token={token}
          initialAppId={profile?.shopeeAppId || ''}
          onUpdate={loadProfile}
        />

        {/* Mercado Livre */}
        {mlConnected && ml ? (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-xl)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '1rem 1.25rem',
                borderBottom: '1px solid var(--color-border-light)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <h3 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 600 }}>📦 Mercado Livre</h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  Conectado como <strong>{ml.nickname}</strong>
                  {ml.expired && (
                    <span style={{ marginLeft: '0.4rem', color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>
                      (token expirado)
                    </span>
                  )}
                </p>
              </div>
              <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-success)' }}>
                ✅ Conectado
              </span>
            </div>
            <div style={{ padding: '1.25rem' }}>
              <MlConfigSection
                mlUserId={ml.mlUserId}
                meliid={ml.meliid || ''}
                melitat={ml.melitat || ''}
                hasSessionCookies={ml.hasSessionCookies}
                token={token}
                onUpdate={loadProfile}
              />
            </div>
          </div>
        ) : (
          <div
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-xl)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '1.25rem',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
                Conecte sua conta do Mercado Livre para gerar links de afiliado.
              </p>
              <button
                onClick={() => { window.location.href = `/api/ml/auth?userId=${user.id}`; }}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #2563eb',
                  background: 'transparent',
                  color: '#2563eb',
                  fontSize: 'var(--text-sm)',
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                + Conectar conta ML
              </button>
            </div>
          </div>
        )}

        {/* Test Conversion */}
        <TestConversionSection token={token} />

        {/* Mirror Config */}
        <MirrorConfigSection token={token} onUpdate={loadProfile} />

        {/* Message Template */}
        <MessageTemplateSection
          token={token}
          initialTemplate={profile?.messageTemplate || ''}
          onUpdate={loadProfile}
        />

        {/* Excluded Groups */}
        <ExcludedGroupsSection
          groups={profile?.excludedGroups || []}
          token={token}
          onUpdate={loadProfile}
        />

        {/* WhatsApp Connection */}
        <WppConnection token={token} />
      </div>
    </PageLayout>
  );
}
