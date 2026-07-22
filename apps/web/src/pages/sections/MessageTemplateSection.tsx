/**
 * MessageTemplateSection — Template de mensagem personalizada
 */
import { useState } from 'react';
import { Card, Button } from '../../components/ui/index.ts';
import { MessageSquare, Save } from 'lucide-react';
import { showErrorToast, showSuccessToast } from '../../lib/toast-emitter.ts';

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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.625rem 0.75rem',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-sm)',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    resize: 'vertical',
    lineHeight: 1.5,
    boxSizing: 'border-box',
  };

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
        {/* Placeholder legend */}
        <div
          style={{
            padding: '0.75rem',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-light)',
            lineHeight: 1.6,
          }}
        >
          <code style={{ color: 'var(--color-primary)', background: 'var(--color-primary-subtle)', padding: '0.1rem 0.3rem', borderRadius: 'var(--radius-sm)' }}>{'{texto_original}'}</code>
          {' — '}Texto original com link convertido
          <br />
          <code style={{ color: 'var(--color-primary)', background: 'var(--color-primary-subtle)', padding: '0.1rem 0.3rem', borderRadius: 'var(--radius-sm)' }}>{'{link_convertido}'}</code>
          {' — '}Apenas o link de afiliado
        </div>

        <textarea
          value={template}
          onChange={(e) => setTemplate((e.target as HTMLTextAreaElement).value)}
          placeholder="{'texto_original'}"
          rows={5}
          style={inputStyle}
        />

        {/* Preview */}
        {template && (
          <div
            style={{
              padding: '0.75rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border-light)',
              fontSize: 'var(--text-xs)',
            }}
          >
            <div style={{ marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>Pré-visualização:</div>
            <div style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {template
                .replace('{texto_original}', '🔗 Confira esta oferta: https://exemplo.com/produto')
                .replace('{link_convertido}', 'https://exemplo.com/produto')}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Button onClick={handleSave} loading={saving} icon={<Save size={16} />} size="sm">
            Salvar Template
          </Button>
          {saved && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 500 }}>✅ Salvo!</span>}
        </div>
      </div>
    </Card>
  );
}
