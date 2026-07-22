/**
 * MirrorFormPage — Formulário de criação/edição de espelhamento
 *
 * Campos: nome, grupos de origem (multi-select), grupos de destino (multi-select),
 * template da mensagem (textarea). Validação client-side, estados de loading/erro.
 * Consome POST /api/mirrors (criação) e PUT /api/mirrors/:id (atualização).
 * Redireciona para listagem após sucesso.
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Button, Input } from '../components/ui/index.ts';
import { GroupOfferAutocomplete } from '../components/GroupOfferAutocomplete.tsx';
import { GroupDestAutocomplete } from '../components/GroupDestAutocomplete.tsx';
import { AlertTriangle, Save, ArrowLeft, Loader2 } from 'lucide-react';

// ─── Types ──────────────────────────────────────────

interface MirrorData {
  id: number;
  name: string;
  userId: number;
  status: string;
  sourceGroups: { jid: string; name: string }[];
  targetGroups: { jid: string; name: string }[];
  messageTemplate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MirrorFormPageProps {
  token: string;
  mirrorId?: number | null;
  onBack: () => void;
}

// ─── Component ──────────────────────────────────────

export function MirrorFormPage({ token, mirrorId, onBack }: MirrorFormPageProps) {
  const isEdit = Boolean(mirrorId);

  // ─── Form state ─────────────────────────────────
  const [name, setName] = useState('');
  const [sourceGroups, setSourceGroups] = useState<{ jid: string; name: string }[]>([]);
  const [targetGroups, setTargetGroups] = useState<{ jid: string; name: string }[]>([]);
  const [messageTemplate, setMessageTemplate] = useState('');

  // ─── UI state ───────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // ─── Validation state ───────────────────────────
  const [nameError, setNameError] = useState<string | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);

  // ─── Fetch existing mirror (edit mode) ──────────
  const fetchMirror = useCallback(async () => {
    if (!mirrorId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/mirrors/${mirrorId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as {
        success: boolean;
        mirror?: MirrorData;
        error?: string;
      };
      if (data.success && data.mirror) {
        setName(data.mirror.name);
        setSourceGroups(data.mirror.sourceGroups ?? []);
        setTargetGroups(data.mirror.targetGroups ?? []);
        setMessageTemplate(data.mirror.messageTemplate ?? '');
      } else {
        setFetchError(data.error || 'Erro ao carregar espelhamento');
      }
    } catch {
      setFetchError('Erro de conexão ao carregar dados do espelhamento');
    }
    setLoading(false);
  }, [mirrorId, token]);

  useEffect(() => {
    if (isEdit) {
      fetchMirror();
    }
  }, [isEdit, fetchMirror]);

  // ─── Validation ─────────────────────────────────
  function validate(): boolean {
    let valid = true;

    if (!name.trim()) {
      setNameError('O nome é obrigatório');
      valid = false;
    } else if (name.trim().length > 255) {
      setNameError('O nome deve ter no máximo 255 caracteres');
      valid = false;
    } else {
      setNameError(null);
    }

    if (sourceGroups.length === 0) {
      setSourceError('Selecione pelo menos 1 grupo de origem');
      valid = false;
    } else {
      setSourceError(null);
    }

    if (targetGroups.length === 0) {
      setTargetError('Selecione pelo menos 1 grupo de destino');
      valid = false;
    } else {
      setTargetError(null);
    }

    return valid;
  }

  // ─── Submit ─────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    if (!validate()) return;

    setSaving(true);

    const payload = {
      name: name.trim(),
      sourceGroups,
      targetGroups,
      messageTemplate: messageTemplate.trim() || null,
    };

    try {
      const url = isEdit ? `/api/mirrors/${mirrorId}` : '/api/mirrors';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json() as {
        success: boolean;
        mirror?: MirrorData;
        error?: string;
      };

      if (data.success) {
        setSuccess(true);
        setTimeout(() => onBack(), 1200);
      } else {
        setSubmitError(data.error || 'Erro ao salvar espelhamento');
        // Exibe erros de validação do backend nos campos
        if (data.error?.toLowerCase().includes('nome')) {
          setNameError(data.error);
        }
      }
    } catch {
      setSubmitError('Erro de conexão ao salvar. Verifique sua conexão e tente novamente.');
    }
    setSaving(false);
  }

  // ─── Loading state ──────────────────────────────
  if (loading) {
    return (
      <PageLayout>
        <PageHeader
          title={isEdit ? 'Editar Espelhamento' : 'Novo Espelhamento'}
          onBack={onBack}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '4rem 0',
            color: 'var(--color-text-muted)',
          }}
        >
          <Loader2 size={32} style={{ animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 'var(--text-sm)' }}>Carregando dados do espelhamento...</span>
        </div>
      </PageLayout>
    );
  }

  // ─── Fetch error state ──────────────────────────
  if (fetchError) {
    return (
      <PageLayout>
        <PageHeader
          title="Editar Espelhamento"
          onBack={onBack}
        />
        <Card>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1rem',
              padding: '2rem 0',
              textAlign: 'center',
            }}
          >
            <AlertTriangle size={40} style={{ color: 'var(--color-error)' }} />
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', margin: 0 }}>
              {fetchError}
            </p>
            <Button variant="outline" onClick={fetchMirror}>
              Tentar novamente
            </Button>
          </div>
        </Card>
      </PageLayout>
    );
  }

  // ─── Success overlay ────────────────────────────
  if (success) {
    return (
      <PageLayout>
        <PageHeader
          title={isEdit ? 'Editar Espelhamento' : 'Novo Espelhamento'}
          onBack={onBack}
        />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '4rem 0',
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: 'var(--color-success-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2rem',
            }}
          >
            ✅
          </div>
          <p style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--color-success)', margin: 0 }}>
            Espelhamento {isEdit ? 'atualizado' : 'criado'} com sucesso!
          </p>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
            Redirecionando...
          </p>
        </div>
      </PageLayout>
    );
  }

  // ─── Form ───────────────────────────────────────
  return (
    <PageLayout>
      <PageHeader
        title={isEdit ? 'Editar Espelhamento' : 'Novo Espelhamento'}
        subtitle={isEdit ? 'Altere os campos desejados e salve' : 'Configure o espelhamento de ofertas entre grupos'}
        onBack={onBack}
      />

      <form onSubmit={handleSubmit}>
        <Card title="📋 Informações Básicas" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Input
              label="Nome do Espelhamento"
              placeholder="Ex: Ofertas Diárias → Grupo VIP"
              value={name}
              onChange={(e) => {
                setName((e.target as HTMLInputElement).value);
                if (nameError) setNameError(null);
              }}
              error={nameError}
              maxLength={255}
              required
            />
          </div>
        </Card>

        <Card title="🔗 Grupos de Origem" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
            Selecione os grupos de onde as ofertas serão capturadas.
          </p>
          <GroupOfferAutocomplete token={token} value={sourceGroups} onChange={(groups) => {
            setSourceGroups(groups);
            if (sourceError) setSourceError(null);
          }} />
          {sourceError && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', marginTop: '0.4rem', marginBottom: 0 }}>
              {sourceError}
            </p>
          )}
        </Card>

        <Card title="🎯 Grupos de Destino" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
            Selecione os grupos para onde as ofertas serão espelhadas.
          </p>
          <GroupDestAutocomplete token={token} value={targetGroups} onChange={(groups) => {
            setTargetGroups(groups);
            if (targetError) setTargetError(null);
          }} />
          {targetError && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)', marginTop: '0.4rem', marginBottom: 0 }}>
              {targetError}
            </p>
          )}
        </Card>

        <Card title="💬 Template da Mensagem">
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
            Personalize a mensagem enviada para o grupo de destino. Use {'{texto_original}'} para incluir o texto com link convertido, ou {'{link_convertido}'} para apenas o link.
          </p>

          <div
            style={{
              padding: '0.75rem',
              background: 'var(--color-bg-secondary)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-light)',
              lineHeight: 1.6,
              marginBottom: '0.75rem',
            }}
          >
            <code style={{ color: 'var(--color-primary)', background: 'var(--color-primary-subtle)', padding: '0.1rem 0.3rem', borderRadius: 'var(--radius-sm)' }}>{'{texto_original}'}</code>
            {' — '}Texto original com link convertido
            <br />
            <code style={{ color: 'var(--color-primary)', background: 'var(--color-primary-subtle)', padding: '0.1rem 0.3rem', borderRadius: 'var(--radius-sm)' }}>{'{link_convertido}'}</code>
            {' — '}Apenas o link de afiliado
          </div>

          <textarea
            value={messageTemplate}
            onChange={(e) => setMessageTemplate((e.target as HTMLTextAreaElement).value)}
            placeholder='{texto_original}'
            rows={5}
            style={{
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
            }}
          />

          {messageTemplate.trim() && (
            <div
              style={{
                padding: '0.75rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-light)',
                fontSize: 'var(--text-xs)',
                marginTop: '0.75rem',
              }}
            >
              <div style={{ marginBottom: '0.25rem', color: 'var(--color-text-muted)' }}>Pré-visualização:</div>
              <div style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {messageTemplate
                  .replace('{texto_original}', '🔗 Confira esta oferta: https://exemplo.com/produto')
                  .replace('{link_convertido}', 'https://exemplo.com/produto')}
              </div>
            </div>
          )}
        </Card>

        {/* Submit Error */}
        {submitError && (
          <div
            style={{
              marginTop: '1rem',
              padding: '0.75rem 1rem',
              background: 'var(--color-error-subtle)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-error-light)',
              color: 'var(--color-error)',
              fontSize: 'var(--text-sm)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <AlertTriangle size={16} /> {submitError}
          </div>
        )}

        {/* Actions */}
        <div
          style={{
            marginTop: '1.5rem',
            display: 'flex',
            gap: '0.75rem',
            alignItems: 'center',
          }}
        >
          <Button type="submit" loading={saving} icon={<Save size={16} />}>
            {isEdit ? 'Atualizar Espelhamento' : 'Criar Espelhamento'}
          </Button>
          <Button type="button" variant="secondary" onClick={onBack} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </form>
    </PageLayout>
  );
}
