/**
 * AmazonConfigSection — Configuração multi-tracking ID Amazon
 *
 * Cada afiliado pode cadastrar ATÉ 100 tracking IDs (limite Amazon Associates).
 * Use `?tag=X` no test-conversion pra forçar um específico.
 *
 * API: /api/amazon/affiliate + /api/amazon/affiliate/tracking-ids
 */
import { useState, useEffect, useCallback } from 'react';
import { Card, Input, Button, Badge, Loading } from '../../components/ui/index.ts';
import { ShoppingBag, Plus, Trash2, Save, Star, StarOff } from 'lucide-react';
import { showErrorToast, showSuccessToast } from '../../lib/toast-emitter.ts';

interface AmazonTrackingId {
  tag: string;
  label?: string;
  region: string;
  active: boolean;
  isDefault: boolean;
  createdAt: string;
}

interface AmazonAffiliateInfo {
  id: number;
  nickname: string | null;
  trackingIds: AmazonTrackingId[];
  activeTrackingCount: number;
  active: boolean;
}

interface AmazonConfigSectionProps {
  token: string;
  initialAffiliate: AmazonAffiliateInfo | null;
  onUpdate: () => void;
}

export function AmazonConfigSection({ token, initialAffiliate, onUpdate }: AmazonConfigSectionProps) {
  const [nickname, setNickname] = useState(initialAffiliate?.nickname ?? '');
  const [trackingIds, setTrackingIds] = useState<AmazonTrackingId[]>(
    initialAffiliate?.trackingIds ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newRegion, setNewRegion] = useState('BR');
  const [adding, setAdding] = useState(false);

  // Sincroniza quando initialAffiliate muda (após save)
  useEffect(() => {
    setNickname(initialAffiliate?.nickname ?? '');
    setTrackingIds(initialAffiliate?.trackingIds ?? []);
  }, [initialAffiliate]);

  const loadAffiliate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/amazon/affiliate', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { success: boolean; affiliate: AmazonAffiliateInfo | null };
      if (data.success && data.affiliate) {
        setNickname(data.affiliate.nickname ?? '');
        setTrackingIds(data.affiliate.trackingIds ?? []);
      }
    } catch {
      /* silencioso */
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadAffiliate();
  }, [loadAffiliate]);

  async function handleSaveProfile() {
    setSavingProfile(true);
    try {
      const res = await fetch('/api/amazon/affiliate', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nickname: nickname || null }),
      });
      const data = await res.json() as { success: boolean };
      if (data.success) {
        showSuccessToast('Amazon', 'Perfil salvo');
        onUpdate();
      } else {
        showErrorToast('Amazon', 'Erro ao salvar perfil');
      }
    } catch {
      showErrorToast('Amazon', 'Erro de conexão');
    }
    setSavingProfile(false);
  }

  async function handleAdd() {
    if (!newTag.trim()) {
      showErrorToast('Amazon', 'Tracking ID é obrigatório');
      return;
    }
    if (trackingIds.length >= 100) {
      showErrorToast('Amazon', 'Limite de 100 tracking IDs atingido');
      return;
    }
    setAdding(true);
    try {
      const res = await fetch('/api/amazon/affiliate/tracking-ids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          tag: newTag.trim(),
          label: newLabel.trim() || undefined,
          region: newRegion,
          isDefault: trackingIds.length === 0, // primeiro vira default automaticamente
        }),
      });
      const data = await res.json() as { success: boolean; trackingIds?: AmazonTrackingId[]; error?: string };
      if (data.success && data.trackingIds) {
        setTrackingIds(data.trackingIds);
        setNewTag('');
        setNewLabel('');
        showSuccessToast('Amazon', 'Tracking ID adicionado');
        onUpdate();
      } else {
        showErrorToast('Amazon', data.error || 'Erro ao adicionar');
      }
    } catch {
      showErrorToast('Amazon', 'Erro de conexão');
    }
    setAdding(false);
  }

  async function handleRemove(tag: string) {
    if (!confirm(`Remover tracking ID "${tag}"?`)) return;
    try {
      const res = await fetch(
        `/api/amazon/affiliate/tracking-ids/${encodeURIComponent(tag)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      const data = await res.json() as { success: boolean; trackingIds?: AmazonTrackingId[] };
      if (data.success && data.trackingIds) {
        setTrackingIds(data.trackingIds);
        showSuccessToast('Amazon', 'Tracking ID removido');
        onUpdate();
      }
    } catch {
      showErrorToast('Amazon', 'Erro ao remover');
    }
  }

  async function handleToggleActive(tag: string, active: boolean) {
    try {
      const res = await fetch(
        `/api/amazon/affiliate/tracking-ids/${encodeURIComponent(tag)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ active }),
        },
      );
      const data = await res.json() as { success: boolean; trackingIds?: AmazonTrackingId[] };
      if (data.success && data.trackingIds) {
        setTrackingIds(data.trackingIds);
        onUpdate();
      }
    } catch {
      showErrorToast('Amazon', 'Erro ao atualizar');
    }
  }

  async function handleSetDefault(tag: string) {
    try {
      const res = await fetch(
        `/api/amazon/affiliate/tracking-ids/${encodeURIComponent(tag)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ isDefault: true }),
        },
      );
      const data = await res.json() as { success: boolean; trackingIds?: AmazonTrackingId[] };
      if (data.success && data.trackingIds) {
        setTrackingIds(data.trackingIds);
        showSuccessToast('Amazon', 'Tracking ID padrão atualizado');
        onUpdate();
      }
    } catch {
      showErrorToast('Amazon', 'Erro ao definir padrão');
    }
  }

  const configured = trackingIds.length > 0;

  return (
    <Card
      title="🛒 Amazon"
      subtitle="Amazon Associates — até 100 tracking IDs"
      action={
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            color: configured ? 'var(--color-success)' : 'var(--color-text-muted)',
          }}
        >
          {configured
            ? `✅ ${trackingIds.filter((t) => t.active).length} ativo(s)`
            : '⚪ Não configurado'}
        </span>
      }
    >
      {loading ? (
        <Loading text="Carregando..." size="sm" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* ─── Apelido do afiliado ─── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Input
              label="Apelido (opcional)"
              value={nickname}
              onChange={(e) => setNickname((e.target as HTMLInputElement).value)}
              placeholder="Ex: Meu Site"
            />
            <Button
              onClick={handleSaveProfile}
              loading={savingProfile}
              icon={<Save size={16} />}
              size="sm"
              variant="secondary"
            >
              Salvar apelido
            </Button>
          </div>

          {/* ─── Lista de tracking IDs ─── */}
          <div>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                marginBottom: '0.5rem',
                color: 'var(--color-text-primary)',
              }}
            >
              Tracking IDs ({trackingIds.length}/100)
            </div>

            {trackingIds.length === 0 ? (
              <div
                style={{
                  padding: '1rem',
                  textAlign: 'center',
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--text-sm)',
                  border: '1px dashed var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                Nenhum tracking ID cadastrado. Adicione seu primeiro abaixo.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {trackingIds.map((t) => (
                  <div
                    key={t.tag}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.625rem 0.75rem',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      background: t.isDefault ? 'var(--color-primary-subtle)' : 'var(--color-surface)',
                      opacity: t.active ? 1 : 0.55,
                    }}
                  >
                    {/* Botão default */}
                    <button
                      onClick={() => !t.isDefault && handleSetDefault(t.tag)}
                      title={t.isDefault ? 'Tracking ID padrão' : 'Marcar como padrão'}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: t.isDefault ? 'default' : 'pointer',
                        padding: 0,
                        display: 'flex',
                        alignItems: 'center',
                        color: t.isDefault ? 'var(--color-warning)' : 'var(--color-text-muted)',
                      }}
                    >
                      {t.isDefault ? <Star size={18} fill="currentColor" /> : <StarOff size={18} />}
                    </button>

                    {/* Tag + label */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-sm)',
                          fontWeight: 600,
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {t.tag}
                      </div>
                      {t.label && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                          {t.label}
                        </div>
                      )}
                    </div>

                    {/* Region badge */}
                    <Badge variant={t.region === 'BR' ? 'success' : 'neutral'}>{t.region}</Badge>

                    {/* Active toggle */}
                    <Button
                      onClick={() => handleToggleActive(t.tag, !t.active)}
                      variant="ghost"
                      size="sm"
                    >
                      {t.active ? '✓ Ativo' : 'Inativo'}
                    </Button>

                    {/* Delete */}
                    <button
                      onClick={() => handleRemove(t.tag)}
                      title="Remover tracking ID"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--color-error)',
                        padding: 4,
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ─── Adicionar novo tracking ID ─── */}
          <div
            style={{
              borderTop: '1px solid var(--color-border-light)',
              paddingTop: '1rem',
            }}
          >
            <div
              style={{
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                marginBottom: '0.5rem',
                color: 'var(--color-text-primary)',
              }}
            >
              Adicionar tracking ID
            </div>
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ flex: '1 1 180px', minWidth: 140 }}>
                <Input
                  label="Tracking ID"
                  value={newTag}
                  onChange={(e) => setNewTag((e.target as HTMLInputElement).value)}
                  placeholder="meusite-20"
                />
              </div>
              <div style={{ flex: '1 1 160px', minWidth: 120 }}>
                <Input
                  label="Apelido (opcional)"
                  value={newLabel}
                  onChange={(e) => setNewLabel((e.target as HTMLInputElement).value)}
                  placeholder="Telegram, YouTube..."
                />
              </div>
              <div style={{ flex: '0 0 90px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 500,
                    color: 'var(--color-text-secondary)',
                    marginBottom: '0.25rem',
                  }}
                >
                  Região
                </label>
                <select
                  value={newRegion}
                  onChange={(e) => setNewRegion((e.target as HTMLSelectElement).value)}
                  style={{
                    width: '100%',
                    padding: '0.5rem',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg)',
                    color: 'var(--color-text-primary)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  <option value="BR">BR (-20)</option>
                  <option value="US">US (-20)</option>
                  <option value="MX">MX (-20)</option>
                  <option value="CA">CA (-20)</option>
                  <option value="UK">UK (-21)</option>
                  <option value="DE">DE (-21)</option>
                  <option value="FR">FR (-21)</option>
                  <option value="JP">JP (-22)</option>
                  <option value="AU">AU (-22)</option>
                  <option value="OTHER">Outra</option>
                </select>
              </div>
              <Button onClick={handleAdd} loading={adding} icon={<Plus size={16} />}>
                Adicionar
              </Button>
            </div>
          </div>

          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
            O Amazon Associates permite até <strong>100 tracking IDs por conta</strong>. Crie um para cada canal
            (Telegram, YouTube, site) pra segmentar suas comissões no portal da Amazon.
          </p>
        </div>
      )}
    </Card>
  );
}
