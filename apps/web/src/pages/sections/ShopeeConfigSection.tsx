/**
 * ShopeeConfigSection — Configuração de credenciais Shopee
 */
import { useState } from 'react';
import { Card, Input, Button } from '../../components/ui/index.ts';
import { Store, Save } from 'lucide-react';
import { showErrorToast, showSuccessToast } from '../../lib/toast-emitter.ts';

interface ShopeeConfigSectionProps {
  token: string;
  initialAppId: string;
  onUpdate: () => void;
}

export function ShopeeConfigSection({ token, initialAppId, onUpdate }: ShopeeConfigSectionProps) {
  const [appId, setAppId] = useState(initialAppId);
  const [appSecret, setAppSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [configured] = useState(!!initialAppId);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/affiliate/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopeeAppId: appId, shopeeAppSecret: appSecret }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setSaved(true);
        showSuccessToast('Shopee', 'Credenciais salvas com sucesso');
        onUpdate();
        setTimeout(() => setSaved(false), 4000);
      } else {
        showErrorToast('Shopee', data.error || 'Erro ao salvar credenciais');
      }
    } catch {
      showErrorToast('Shopee', 'Erro de conexão ao salvar credenciais');
    }
    setSaving(false);
  }

  return (
    <Card
      title="🛒 Shopee"
      subtitle="Credenciais da API Shopee"
      action={
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: configured ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
          {configured ? '✅ Configurado' : '⚪ Não configurado'}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <Input
          label="App ID"
          value={appId}
          onChange={(e) => setAppId((e.target as HTMLInputElement).value)}
          placeholder="Seu App ID da Shopee"
        />
        <Input
          label="App Secret"
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret((e.target as HTMLInputElement).value)}
          placeholder="Seu App Secret da Shopee"
        />
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
