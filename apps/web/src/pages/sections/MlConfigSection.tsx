/**
 * MlConfigSection — Sub-componente de configuração ML (meliid, melitat, cookies)
 *
 * Mantido como componente separado para ser usado dentro do dashboard.
 */
import { useState } from 'react';
import { Button, Input, Dialog } from '../../components/ui/index.ts';
import { Save, ExternalLink, Trash2 } from 'lucide-react';
import { showErrorToast, showSuccessToast } from '../../lib/toast-emitter.ts';

interface MlConfigSectionProps {
  mlUserId: string;
  meliid: string;
  melitat: string;
  hasSessionCookies: boolean;
  token: string;
  onUpdate: () => void;
}

export function MlConfigSection({
  mlUserId,
  meliid: initialMeliid,
  melitat: initialMelitat,
  hasSessionCookies,
  token,
  onUpdate,
}: MlConfigSectionProps) {
  const [meliid, setMeliid] = useState(initialMeliid);
  const [melitat, setMelitat] = useState(initialMelitat);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);

  async function handleClearCookies() {
    setClearDialogOpen(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/ml/affiliates/${mlUserId}/cookies`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Falha ao limpar cookies');
      showSuccessToast('Mercado Livre', 'Cookies limpos com sucesso');
      onUpdate();
    } catch {
      showErrorToast('Mercado Livre', 'Erro ao limpar cookies');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/ml/affiliates/${mlUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ meliid: meliid || undefined, melitat: melitat || undefined }),
      });
      setSaved(true);
      showSuccessToast('Mercado Livre', 'Configurações salvas com sucesso');
      onUpdate();
      setTimeout(() => setSaved(false), 4000);
    } catch {
      showErrorToast('Mercado Livre', 'Erro de conexão ao salvar');
    }
    setSaving(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      <Input
        label="MELIID (opcional — formato antigo)"
        value={meliid}
        onChange={(e) => setMeliid((e.target as HTMLInputElement).value)}
        placeholder="Formato antigo"
      />
      <Input
        label="MELITAT (etiqueta)"
        value={melitat}
        onChange={(e) => setMelitat((e.target as HTMLInputElement).value)}
        placeholder="Ex: mtorreao"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <Button onClick={handleSave} loading={saving} icon={<Save size={16} />} size="sm">
          Salvar
        </Button>
        <Button
          onClick={() => setClearDialogOpen(true)}
          loading={saving}
          icon={<Trash2 size={16} />}
          size="sm"
          variant="danger"
          disabled={!hasSessionCookies}
        >
          Limpar cookies
        </Button>
        {saved && (
          <span
            style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 500 }}
          >
            ✅ Salvo!
          </span>
        )}
        <span
          style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 500,
            color: hasSessionCookies ? 'var(--color-success)' : 'var(--color-text-muted)',
          }}
        >
          {hasSessionCookies ? '🔗 Cookies OK' : '📎 Sem cookies'}
        </span>
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', margin: 0 }}>
        Para importar cookies de sessão, use a{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.open('/chrome-cookie-importer', '_blank');
          }}
          style={{
            color: 'var(--color-primary)',
            textDecoration: 'underline',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.2rem',
          }}
        >
          extensão Chrome <ExternalLink size={12} />
        </a>
      </p>
      <Dialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        title="Limpar cookies do Mercado Livre?"
        description="Essa ação remove os cookies de sessão salvos no aplicativo. Os campos MELIID e MELITAT serão preservados."
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
          <Button variant="outline" onClick={() => setClearDialogOpen(false)}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleClearCookies}
            loading={saving}
            icon={<Trash2 size={16} />}
          >
            Limpar cookies
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
