/**
 * SettingsPage — Página de configurações com 5 abas
 *
 * Reúne todas as seções de configuração (WhatsApp, Grupos, Shopee, ML, Amazon)
 * em abas organizadas com Radix Tabs.
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Tabs } from '../components/ui/Tabs.tsx';
import { Card } from '../components/ui/Card.tsx';
import { Loading } from '../components/ui/Loading.tsx';
import { ShopeeConfigSection } from './sections/ShopeeConfigSection.tsx';
import { MlConfigSection } from './sections/MlConfigSection.tsx';
import { AmazonConfigSection } from './sections/AmazonConfigSection.tsx';
import { TestConversionSection } from './sections/TestConversionSection.tsx';
import { MirrorConfigSection } from './sections/MirrorConfigSection.tsx';
import { MessageTemplateSection } from './sections/MessageTemplateSection.tsx';
import { ExcludedGroupsSection } from './sections/ExcludedGroupsSection.tsx';
import { WppConnection } from '../components/WppConnection.tsx';
import { Store, Package, Smartphone, Users, ShoppingBag } from 'lucide-react';

interface ProfileData {
  id: number;
  email: string;
  name: string;
  shopeeConfigured: boolean;
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
}

interface SettingsPageProps {
  user: { id: number; email: string; name: string };
  token: string;
}

const TABS = [
  { value: 'whatsapp', label: 'WhatsApp', icon: <Smartphone size={16} /> },
  { value: 'grupos', label: 'Grupos', icon: <Users size={16} /> },
  { value: 'shopee', label: 'Shopee', icon: <Store size={16} /> },
  { value: 'mercadolivre', label: 'Mercado Livre', icon: <Package size={16} /> },
  { value: 'amazon', label: 'Amazon', icon: <ShoppingBag size={16} /> },
];

export function SettingsPage({ user, token }: SettingsPageProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('whatsapp');

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
        <Loading text="Carregando configurações..." />
      </PageLayout>
    );
  }

  const mlConnected = profile?.mercadoLivre.connected === true;
  const ml = mlConnected ? (profile!.mercadoLivre as Exclude<ProfileData['mercadoLivre'], { connected: false }>) : null;

  return (
    <PageLayout maxWidth="960px">
      <PageHeader title="Configurações" subtitle="Gerencie suas integrações" />

      <Tabs tabs={TABS} value={activeTab} onValueChange={setActiveTab}>
        {/* Aba 1: WhatsApp */}
        <div>
          <WppConnection token={token} />
        </div>

        {/* Aba 2: Grupos */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <MirrorConfigSection token={token} onUpdate={loadProfile} />
          <MessageTemplateSection
            token={token}
            initialTemplate={profile?.messageTemplate || ''}
            onUpdate={loadProfile}
          />
          <ExcludedGroupsSection
            groups={profile?.excludedGroups || []}
            token={token}
            onUpdate={loadProfile}
          />
        </div>

        {/* Aba 3: Shopee */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <ShopeeConfigSection
            token={token}
            initialAppId={profile?.shopeeAppId || ''}
            onUpdate={loadProfile}
          />
          <div style={{ marginTop: '1.25rem' }}>
            <TestConversionSection token={token} />
          </div>
        </div>

        {/* Aba 4: Mercado Livre */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {mlConnected && ml ? (
            <Card
              title="📦 Mercado Livre"
              subtitle={`Conectado como ${ml.nickname}${ml.expired ? ' (token expirado)' : ''}`}
              action={
                <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-success)' }}>
                  ✅ Conectado
                </span>
              }
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
            <Card
              title="📦 Mercado Livre"
              subtitle="Conecte sua conta do Mercado Livre para gerar links de afiliado"
            >
              <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
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

        {/* Aba 5: Amazon */}
        <div>
          <AmazonConfigSection
            token={token}
            initialTrackingId={profile?.amazonTrackingId || ''}
            onUpdate={loadProfile}
          />
        </div>
      </Tabs>
    </PageLayout>
  );
}
