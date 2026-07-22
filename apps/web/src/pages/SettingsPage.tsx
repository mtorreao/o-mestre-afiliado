/**
 * SettingsPage — Página de configurações com 3 abas
 *
 * Abas: WhatsApp, Shopee, Mercado Livre
 * Reutiliza seções existentes do dashboard.
 *
 * Loading por seção: cada seção carrega independentemente.
 */
import { useState, useEffect, useCallback } from 'react';
import { Smartphone, Store, Package, ShoppingBag } from 'lucide-react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Loading, Tabs } from '../components/ui/index.ts';
import { fetchApi } from '../lib/api-client.ts';
import { WppConnection } from '../components/WppConnection.tsx';
import { ShopeeConfigSection } from './sections/ShopeeConfigSection.tsx';
import { MlConfigSection } from './sections/MlConfigSection.tsx';
import { AmazonConfigSection } from './sections/AmazonConfigSection.tsx';
import { TestConversionSection } from './sections/TestConversionSection.tsx';
import { MirrorConfigSection } from './sections/MirrorConfigSection.tsx';
import { MessageTemplateSection } from './sections/MessageTemplateSection.tsx';
import { ExcludedGroupsSection } from './sections/ExcludedGroupsSection.tsx';
import { FiltersSection } from './sections/FiltersSection.tsx';
import { WppConnection } from '../components/WppConnection.tsx';

interface ProfileData {
  shopeeAppId: string | null;
  amazonTrackingId: string | null;
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
  filters?: {
    blacklist: string[];
    keywords: string[];
    dedupHours: number;
  };
}

interface SettingsPageProps {
  user: { id: number; email: string; name: string };
  token: string;
}

const tabs = [
  { value: 'whatsapp', label: 'WhatsApp', icon: <Smartphone size={16} /> },
  { value: 'shopee', label: 'Shopee', icon: <Store size={16} /> },
  { value: 'mercadolivre', label: 'Mercado Livre', icon: <Package size={16} /> },
  { value: 'amazon', label: 'Amazon', icon: <ShoppingBag size={16} /> },
];

export function SettingsPage({ user, token }: SettingsPageProps) {
  const [activeTab, setActiveTab] = useState('whatsapp');
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    const res = await fetchApi<{ success: boolean; profile: ProfileData }>(
      '/api/affiliate/profile',
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.success && res.data?.profile) {
      setProfile(res.data.profile);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const mlConnected = profile?.mercadoLivre.connected === true;
  const ml = mlConnected
    ? (profile!.mercadoLivre as Exclude<ProfileData['mercadoLivre'], { connected: false }>)
    : null;

  return (
    <PageLayout maxWidth="960px">
      <PageHeader title="Configurações" subtitle="Gerencie suas integrações" />

      <Tabs tabs={tabs} value={activeTab} onValueChange={setActiveTab}>
        {/* Aba 1: WhatsApp — loading independente pelo próprio componente */}
        <WppConnection token={token} />

        {/* Aba 2: Shopee */}
        {loading ? (
          <Loading text="Carregando perfil..." size="sm" />
        ) : (
          <ShopeeConfigSection
            token={token}
            initialAppId={profile?.shopeeAppId || ''}
            onUpdate={loadProfile}
          />
        )}

        {/* Aba 3: Mercado Livre */}
        {loading ? (
          <Loading text="Carregando perfil..." size="sm" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
            {mlConnected && ml ? (
              <Card
                title="📦 Mercado Livre"
                subtitle={
                  <>
                    Conectado como <strong>{ml.nickname}</strong>
                    {ml.expired && (
                      <span style={{ marginLeft: '0.4rem', color: 'var(--color-error)', fontSize: 'var(--text-xs)' }}>
                        (token expirado)
                      </span>
                    )}
                  </>
                }
                action={<span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-success)' }}>✅ Conectado</span>}
              >
                <MlConfigSection
                  mlUserId={ml.mlUserId}
                  meliid={ml.meliid || ''}
                  melitat={ml.melitat || ''}
                  hasSessionCookies={ml.hasSessionCookies}
                  token={token}
                  onUpdate={loadProfile}
                />
              </Card>
            ) : (
              <Card>
                <div style={{ textAlign: 'center' }}>
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
              </Card>
            )}
            <TestConversionSection token={token} />
          </div>
        )}
      </Tabs>
    </PageLayout>
  );
}
