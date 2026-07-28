/**
 * AmazonConfigSection — configuração de um único Tracking ID Amazon.
 *
 * O Tracking ID é a única credencial necessária para gerar links Amazon.
 * API: /api/amazon/affiliate/tracking-ids
 */
import { useCallback, useEffect, useState } from 'react';
import { ShoppingBag, Trash2 } from 'lucide-react';
import { Button, Card, Input, Loading } from '../../components/ui/index.ts';
import { showErrorToast, showSuccessToast } from '../../lib/toast-emitter.ts';

interface AmazonTrackingId {
  tag: string;
  region: string;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
}

interface AmazonAffiliateInfo {
  id: number;
  trackingIds: AmazonTrackingId[];
  activeTrackingCount: number;
  active: boolean;
}

interface AmazonConfigSectionProps {
  token: string;
  initialAffiliate: AmazonAffiliateInfo | null;
  onUpdate: () => void;
}

export function AmazonConfigSection({
  token,
  initialAffiliate,
  onUpdate,
}: AmazonConfigSectionProps) {
  const [trackingId, setTrackingId] = useState<AmazonTrackingId | null>(
    initialAffiliate?.trackingIds[0] ?? null,
  );
  const [newTag, setNewTag] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    setTrackingId(initialAffiliate?.trackingIds[0] ?? null);
  }, [initialAffiliate]);

  const loadAffiliate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/amazon/affiliate', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as {
        success: boolean;
        affiliate: AmazonAffiliateInfo | null;
      };
      if (data.success) {
        setTrackingId(data.affiliate?.trackingIds[0] ?? null);
      }
    } catch {
      showErrorToast('Amazon', 'Não foi possível carregar a integração');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAffiliate();
  }, [loadAffiliate]);

  async function handleSave() {
    const tag = newTag.trim();
    if (!tag) {
      showErrorToast('Amazon', 'Informe seu Tracking ID');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/amazon/affiliate/tracking-ids', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ tag }),
      });
      const data = (await res.json()) as {
        success: boolean;
        trackingIds?: AmazonTrackingId[];
        error?: string;
      };

      if (!data.success || !data.trackingIds?.[0]) {
        showErrorToast('Amazon', data.error || 'Não foi possível salvar o Tracking ID');
        return;
      }

      setTrackingId(data.trackingIds[0]);
      setNewTag('');
      showSuccessToast('Amazon', 'Tracking ID salvo');
      onUpdate();
    } catch {
      showErrorToast('Amazon', 'Erro de conexão');
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!trackingId || !confirm(`Remover o Tracking ID "${trackingId.tag}"?`)) return;

    setRemoving(true);
    try {
      const res = await fetch(
        `/api/amazon/affiliate/tracking-ids/${encodeURIComponent(trackingId.tag)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = (await res.json()) as { success: boolean; error?: string };

      if (!data.success) {
        showErrorToast('Amazon', data.error || 'Não foi possível remover o Tracking ID');
        return;
      }

      setTrackingId(null);
      showSuccessToast('Amazon', 'Tracking ID removido');
      onUpdate();
    } catch {
      showErrorToast('Amazon', 'Erro de conexão');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Card
      title="Amazon"
      subtitle="Informe o Tracking ID da sua conta Amazon Associates"
      action={
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            color: trackingId ? 'var(--color-success)' : 'var(--color-text-muted)',
          }}
        >
          {trackingId ? 'Configurado' : 'Não configurado'}
        </span>
      }
    >
      {loading ? (
        <Loading text="Carregando..." size="sm" />
      ) : trackingId ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--spacing-3)',
              padding: 'var(--spacing-4)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--color-surface)',
            }}
          >
            <ShoppingBag size={20} color="var(--color-primary)" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Tracking ID ativo
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                  overflowWrap: 'anywhere',
                }}
              >
                {trackingId.tag}
              </div>
            </div>
            <Button
              onClick={handleRemove}
              loading={removing}
              variant="ghost"
              size="sm"
              icon={<Trash2 size={16} />}
            >
              Remover
            </Button>
          </div>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
            Este ID será usado em todas as ofertas Amazon espelhadas pela sua conta.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-4)' }}>
          <p
            style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}
          >
            Encontre o ID no portal Amazon Associates. Exemplo: <strong>minhaloja-20</strong>.
          </p>
          <div style={{ display: 'flex', gap: 'var(--spacing-3)', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <Input
                label="Tracking ID"
                value={newTag}
                onChange={(event) => setNewTag((event.target as HTMLInputElement).value)}
                placeholder="minhaloja-20"
              />
            </div>
            <Button onClick={handleSave} loading={saving}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
