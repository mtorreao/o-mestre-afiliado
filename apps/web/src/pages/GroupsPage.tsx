/**
 * GroupsPage — Página dedicada para configuração de grupos de espelhamento
 *
 * Reúne MirrorConfigSection, MessageTemplateSection e ExcludedGroupsSection
 * em uma página independente, separada das configurações de marketplace.
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Loading } from '../components/ui/index.ts';
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

  return (
    <PageLayout maxWidth="960px">
      <PageHeader
        title="Grupos de Espelhamento"
        subtitle="Configure os grupos de origem e destino para espelhamento de ofertas"
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-5)' }}>
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
    </PageLayout>
  );
}
