/**
 * AmazonConfigSection — Configuração do Amazon Tracking ID
 *
 * Amazon Associates usa o parâmetro ?tag= na URL.
 * O tracking ID é salvo em user_credentials.amazon_tracking_id
 * via PUT /api/affiliate/profile.
 */
import { useState } from 'react';
import { Card, Input, Button } from '../../components/ui/index.ts';
import { ShoppingBag, Save } from 'lucide-react';

interface AmazonConfigSectionProps {
  token: string;
  initialTrackingId: string;
  onUpdate: () => void;
}

export function AmazonConfigSection({ token, initialTrackingId, onUpdate }: AmazonConfigSectionProps) {
  const [trackingId, setTrackingId] = useState(initialTrackingId);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const configured = !!initialTrackingId;

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/affiliate/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amazonTrackingId: trackingId || undefined }),
      });
      const data = await res.json() as { success: boolean };
      if (data.success) {
        setSaved(true);
        onUpdate();
        setTimeout(() => setSaved(false), 4000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  }

  return (
    <Card
      title="🛒 Amazon"
      subtitle="Amazon Associates Tracking ID"
      action={
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: configured ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
          {configured ? '✅ Configurado' : '⚪ Não configurado'}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <Input
          label="Amazon Tracking ID"
          value={trackingId}
          onChange={(e) => setTrackingId((e.target as HTMLInputElement).value)}
          placeholder="Ex: meusite-20"
        />
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
          O Tracking ID é o código de afiliado da Amazon Associates.
          Ex: <code>meusite-20</code>. Será usado como parâmetro <code>?tag=</code> nos links.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.25rem' }}>
          <Button onClick={handleSave} loading={saving} icon={<Save size={16} />} size="sm">
            Salvar
          </Button>
          {saved && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 500 }}>✅ Salvo!</span>}
        </div>
      </div>
    </Card>
  );
}
