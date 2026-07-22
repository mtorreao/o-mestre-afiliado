/**
 * ExcludedGroupsSection — Grupos desativados com opções de revalidação e força
 */
import { useState } from 'react';
import { Card, Button, Badge } from '../../components/ui/index.ts';
import { RotateCw, Zap } from 'lucide-react';

interface ExcludedGroup {
  groupJid: string;
  groupName: string;
  reason: string;
  ratio: number;
  totalMessages: number;
  validOffers: number;
}

interface ExcludedGroupsSectionProps {
  groups: ExcludedGroup[];
  token: string;
  onUpdate: () => void;
}

export function ExcludedGroupsSection({ groups, token, onUpdate }: ExcludedGroupsSectionProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  async function handleRevalidate(group: ExcludedGroup) {
    setActionLoading(group.groupJid);
    try {
      await fetch('/api/affiliate/revalidate-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ groupJid: group.groupJid, groupName: group.groupName }),
      });
      onUpdate();
    } catch { /* ignore */ }
    setActionLoading(null);
  }

  async function handleForce(group: ExcludedGroup) {
    setActionLoading(group.groupJid);
    try {
      await fetch('/api/affiliate/force-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ groupJid: group.groupJid, groupName: group.groupName }),
      });
      onUpdate();
    } catch { /* ignore */ }
    setActionLoading(null);
  }

  if (groups.length === 0) return null;

  return (
    <Card
      title="⚠️ Grupos Desativados"
      subtitle="Grupos que não atingiram o mínimo de 70% de ofertas válidas"
      action={<Badge variant="error">{groups.length} desativado(s)</Badge>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {groups.map((group) => (
          <div
            key={group.groupJid}
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-error-subtle)',
              border: '1px solid var(--color-error-light)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-error)', marginBottom: '0.25rem' }}>
                  {group.groupName}
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                  <span>📊 {Math.round(group.ratio * 100)}% de ofertas</span>
                  <span>✅ {group.validOffers} de {group.totalMessages} válidas</span>
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  {group.reason}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRevalidate(group)}
                loading={actionLoading === group.groupJid}
                icon={<RotateCw size={14} />}
              >
                Revalidar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleForce(group)}
                loading={actionLoading === group.groupJid}
                icon={<Zap size={14} />}
                style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}
              >
                Ativar mesmo assim
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
