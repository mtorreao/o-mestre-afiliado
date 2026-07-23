/**
 * MessageTemplateSection — Template de mensagem personalizada
 *
 * Agora usa TemplateEditor + TemplatePreview.
 */
import { useState } from 'react';
import { Card, Button } from '../../components/ui/index.ts';
import { MessageSquare, Save } from 'lucide-react';
import { showErrorToast, showSuccessToast } from '../../lib/toast-emitter.ts';
import { TemplateEditor } from '../../components/TemplateEditor.tsx';
import { TemplatePreview } from '../../components/TemplatePreview.tsx';

interface MessageTemplateSectionProps {
  token: string;
  initialTemplate: string;
  onUpdate: () => void;
}

export function MessageTemplateSection({ token, initialTemplate, onUpdate }: MessageTemplateSectionProps) {
  const [template, setTemplate] = useState(initialTemplate);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch('/api/affiliate/message-template', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messageTemplate: template || null }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setSaved(true);
        showSuccessToast('Template', 'Template salvo com sucesso');
        onUpdate();
        setTimeout(() => setSaved(false), 4000);
      } else {
        showErrorToast('Template', data.error || 'Erro ao salvar template');
      }
    } catch {
      showErrorToast('Template', 'Erro de conexão ao salvar');
    }
    setSaving(false);
  }

  return (
    <Card
      title="💬 Template de Mensagem"
      subtitle="Personalize a mensagem enviada para o grupo de destino"
      action={
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: template ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
          {template ? '✅ Personalizado' : '📝 Padrão'}
        </span>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <TemplateEditor
          value={template}
          onChange={setTemplate}
          token={token}
          showDefaultHint={true}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Button onClick={handleSave} loading={saving} icon={<Save size={16} />} size="sm">
            Salvar Template
          </Button>
          {saved && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 500 }}>✅ Salvo!</span>}
        </div>

        {/* Preview com URL real */}
        <TemplatePreview
          token={token}
          template={template}
        />
      </div>
    </Card>
  );
}
