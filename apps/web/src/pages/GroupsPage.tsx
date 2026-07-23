/**
 * GroupsPage — Página dedicada para configuração de grupos de espelhamento
 *
 * Reúne MirrorConfigSection, MessageTemplateSection e ExcludedGroupsSection
 * em uma página independente, separada das configurações de marketplace.
 *
 * Loading por seção: cada card carrega seu próprio conteúdo.
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Loading } from '../components/ui/index.ts';
import { fetchApi } from '../lib/api-client.ts';
import { MirrorConfigSection } from './sections/MirrorConfigSection.tsx';
import { MessageTemplateSection } from './sections/MessageTemplateSection.tsx';
import { ExcludedGroupsSection } from './sections/ExcludedGroupsSection.tsx';

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

interface GroupsPageProps {
  token: string;
}

export function GroupsPage({ token }: GroupsPageProps) {
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

  return (
    <PageLayout maxWidth="960px">
      <PageHeader
        title="Espelhamento"
        subtitle="Configure os grupos de origem e destino para espelhamento de ofertas"
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
        {/* Mirror Config — loading independente */}
        <MirrorConfigSection
          token={token}
          onUpdate={loadProfile}
          initialOfferGroups={profile?.sourceGroups || []}
          initialDestGroups={profile?.targetGroups || []}
        />

        {/* Message Template */}
        {loading ? (
          <Card title="💬 Template de Mensagem">
            <Loading text="Carregando template..." size="sm" />
          </Card>
        ) : (
          <MessageTemplateSection
            token={token}
            initialTemplate={profile?.messageTemplate || ''}
            onUpdate={loadProfile}
          />
        )}

        {/* Excluded Groups */}
        {loading ? (
          <Card title="⚠️ Grupos Desativados">
            <Loading text="Carregando grupos..." size="sm" />
          </Card>
        ) : (
          <ExcludedGroupsSection
            groups={profile?.excludedGroups || []}
            token={token}
            onUpdate={loadProfile}
          />
        )}
      </div>
    </PageLayout>
  );
}
