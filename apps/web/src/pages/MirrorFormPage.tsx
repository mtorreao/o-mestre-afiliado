/**
 * MirrorFormPage — Formulário de criação/edição de espelhamento
 *
 * Campos: nome, grupos de origem (multi-select), grupos de destino (multi-select),
 * template da mensagem (textarea). Validação client-side, estados de loading/erro.
 * Consome POST /api/mirrors (criação) e PUT /api/mirrors/:id (atualização).
 * Redireciona para listagem após sucesso.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Button, Input } from '../components/ui/index.ts';
import { GroupOfferAutocomplete } from '../components/GroupOfferAutocomplete.tsx';
import { GroupDestAutocomplete } from '../components/GroupDestAutocomplete.tsx';
import { TemplateEditor } from '../components/TemplateEditor.tsx';
import { TemplatePreview } from '../components/TemplatePreview.tsx';
import { validateMirrorForm } from '../lib/mirror-form-pure.ts';
import type { MirrorFormErrors } from '../lib/mirror-form-pure.ts';
import { createEmptyMirrorFormState } from '../lib/mirror-form-reset-pure.ts';
import { AlertTriangle, Save, ArrowLeft, Loader2, Plus, RotateCw } from 'lucide-react';
import { EMPTY_SNAPSHOT, isFormDirty, serializeFormSnapshot } from '../lib/dirty-guard-pure.ts';

// ─── A11y: ids estaveis para foco e aria-describedby ──
const NAME_INPUT_ID = 'mirror-form-nome';
const NAME_TITLE_ID = 'mirror-form-nome-titulo';
const SOURCE_INPUT_ID = 'mirror-form-origem-input';
const TARGET_INPUT_ID = 'mirror-form-destino-input';
const SOURCE_TITLE_ID = 'mirror-form-origem-titulo';
const TARGET_TITLE_ID = 'mirror-form-destino-titulo';
const SOURCE_ERROR_ID = 'mirror-form-origem-error';
const TARGET_ERROR_ID = 'mirror-form-destino-error';
const SUCCESS_TITLE_ID = 'mirror-form-success-title';

// ─── Types ──────────────────────────────────────────

interface MirrorData {
  id: number;
  name: string;
  userId: number;
  status: string;
  sourceGroups: { jid: string; name: string }[];
  targetGroups: { jid: string; name: string }[];
  messageTemplate: string | null;
  subRateLimitMaxMsgs: number | null;
  subRateLimitWindowSec: number | null;
  createdAt: string;
  updatedAt: string;
}

interface MirrorFormPageProps {
  token: string;
  onBack: () => void;
}

// ─── Component ──────────────────────────────────────

export function MirrorFormPage({ token, onBack }: MirrorFormPageProps) {
  const { id } = useParams<{ id: string }>();
  const mirrorId = id ? parseInt(id, 10) : null;
  const isEdit = Boolean(mirrorId);

  // ─── Form state ─────────────────────────────────
  const [name, setName] = useState('');
  const [sourceGroups, setSourceGroups] = useState<{ jid: string; name: string }[]>([]);
  const [targetGroups, setTargetGroups] = useState<{ jid: string; name: string }[]>([]);
  const [messageTemplate, setMessageTemplate] = useState('');
  // Sub-rate limit desativado temporariamente — campos do form ocultados.
  // Mantemos a tipagem MirrorData.subRateLimit* para não quebrar desserialização.
  // const [subRateMaxMsgs, setSubRateMaxMsgs] = useState<number | null>(null);
  // const [subRateWindowSec, setSubRateWindowSec] = useState<number | null>(null);

  // ─── Dirty guard (saída com mudanças não salvas) ─────
  // Snapshot inicial do form (string serializada). Em modo criação parte do
  // estado vazio; em modo edição é preenchido após o fetch (fetchMirror).
  // Após save bem-sucedido o snapshot é atualizado para o estado salvo,
  // zerando o dirty flag.
  const snapshotRef = useRef<string | null>(isEdit ? null : serializeFormSnapshot(EMPTY_SNAPSHOT));

  const isDirty = isFormDirty(
    { name, sourceGroups, targetGroups, messageTemplate },
    snapshotRef.current,
  );

  // beforeunload: bloqueia fechar/recarregar a aba com form sujo
  // (usa o diálogo nativo do navegador — window.confirm não funciona aqui).
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Saída com confirmação: usada pelo onBack do PageHeader e pelo botão
  // Cancelar. Se o form está sujo, pergunta antes de sair (PT-BR).
  const confirmLeave = useCallback((): boolean => {
    if (!isDirty) return true;
    return window.confirm('Existem mudanças não salvas. Deseja realmente sair?');
  }, [isDirty]);

  const handleBack = useCallback(() => {
    if (confirmLeave()) onBack();
  }, [confirmLeave, onBack]);

  // ─── UI state ───────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  /**
   * Refresh manual dos grupos do WhatsApp. Bumpando este número,
   * os autocompletes de origem e destino re-baixam a lista com
   * `?force=true`, ignorando o cache de 1 dia.
   */
  const [groupsRefreshSignal, setGroupsRefreshSignal] = useState(0);

  // ─── Refs (foco/scroll no primeiro campo com erro) ─
  const nameRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

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
      const data = (await res.json()) as {
        success: boolean;
        mirror?: MirrorData;
        error?: string;
      };
      if (data.success && data.mirror) {
        setName(data.mirror.name);
        setSourceGroups(data.mirror.sourceGroups ?? []);
        setTargetGroups(data.mirror.targetGroups ?? []);
        setMessageTemplate(data.mirror.messageTemplate ?? '');
        // Snapshot inicial do modo edição — carga de dados não conta como edição.
        snapshotRef.current = serializeFormSnapshot({
          name: data.mirror.name,
          sourceGroups: data.mirror.sourceGroups ?? [],
          targetGroups: data.mirror.targetGroups ?? [],
          messageTemplate: data.mirror.messageTemplate ?? '',
        });
        // Sub-rate limit desativado temporariamente.
        // setSubRateMaxMsgs(data.mirror.subRateLimitMaxMsgs ?? null);
        // setSubRateWindowSec(data.mirror.subRateLimitWindowSec ?? null);
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

  // A11y: ao montar o success state, move o foco para o titulo da pagina.
  useEffect(() => {
    if (success) {
      document.getElementById(SUCCESS_TITLE_ID)?.focus();
    }
  }, [success]);

  // ─── Validation ─────────────────────────────────
  /** Valida todos os campos via função pura e publica os erros no state. */
  function validate(): MirrorFormErrors {
    const formErrors = validateMirrorForm({ name, sourceGroups, targetGroups });
    setNameError(formErrors.name ?? null);
    setSourceError(formErrors.sourceGroups ?? null);
    setTargetError(formErrors.targetGroups ?? null);
    return formErrors;
  }

  /** Valida apenas o campo que saiu do foco (feedback incremental sem submit). */
  function validateField(field: 'name' | 'sourceGroups' | 'targetGroups'): void {
    const formErrors = validateMirrorForm({ name, sourceGroups, targetGroups });
    if (field === 'name') setNameError(formErrors.name ?? null);
    else if (field === 'sourceGroups') setSourceError(formErrors.sourceGroups ?? null);
    else setTargetError(formErrors.targetGroups ?? null);
  }

  /** Foca e rola até o primeiro campo com erro (ordem: nome → origem → destino). */
  function focusFirstError(formErrors: MirrorFormErrors): void {
    const firstRef = formErrors.name
      ? nameRef
      : formErrors.sourceGroups
        ? sourceRef
        : formErrors.targetGroups
          ? targetRef
          : null;
    if (!firstRef || !firstRef.current) return;
    firstRef.current.focus({ preventScroll: true });
    firstRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ─── Submit ─────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);

    const formErrors = validate();
    if (formErrors.name || formErrors.sourceGroups || formErrors.targetGroups) {
      focusFirstError(formErrors);
      return;
    }

    setSaving(true);

    const payload = {
      name: name.trim(),
      sourceGroups,
      targetGroups,
      messageTemplate: messageTemplate.trim() || null,
      // Sub-rate limit desativado temporariamente — não envia ao backend.
      subRateLimitMaxMsgs: null,
      subRateLimitWindowSec: null,
    };

    try {
      const url = isEdit ? `/api/mirrors/${mirrorId}` : '/api/mirrors';
      const method = isEdit ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as {
        success: boolean;
        mirror?: MirrorData;
        error?: string;
      };

      if (data.success) {
        // Form salvo — zera o dirty flag: sair daqui em diante não pede confirmação.
        // Snapshot usa o estado RAW do form (não o payload trimado): o que o
        // usuário vê nos campos é o que vira base de comparação.
        snapshotRef.current = serializeFormSnapshot({
          name,
          sourceGroups,
          targetGroups,
          messageTemplate,
        });
        setSuccess(true);
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

  // ─── Criar outro espelhamento (reset do form) ────
  function handleCreateAnother() {
    const reset = createEmptyMirrorFormState();
    setName(reset.name);
    setSourceGroups(reset.sourceGroups);
    setTargetGroups(reset.targetGroups);
    setMessageTemplate(reset.messageTemplate);
    setNameError(reset.nameError);
    setSourceError(reset.sourceError);
    setTargetError(reset.targetError);
    setSubmitError(reset.submitError);
    setSuccess(reset.success);
  }

  // ─── Loading state ──────────────────────────────
  if (loading) {
    return (
      <PageLayout>
        <PageHeader
          title={isEdit ? 'Editar Espelhamento' : 'Novo Espelhamento'}
          onBack={handleBack}
        />
        <div role="status" aria-label="Carregando formulário" aria-busy="true">
          {/* Card 1 — Informações Básicas */}
          <Card style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="skeleton-block" style={{ width: '45%', height: 16 }} />
              <div className="skeleton-block" style={{ width: '30%', height: 12 }} />
              <div
                className="skeleton-block"
                style={{ width: '100%', height: 38, borderRadius: 'var(--radius-md)' }}
              />
            </div>
          </Card>

          {/* Cards 2 e 3 — Grupos de Origem / Destino */}
          {['Origem', 'Destino'].map((label) => (
            <Card key={label} style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div className="skeleton-block" style={{ width: '55%', height: 16 }} />
                <div className="skeleton-block" style={{ width: '70%', height: 12 }} />
                <div
                  className="skeleton-block"
                  style={{ width: '100%', height: 38, borderRadius: 'var(--radius-md)' }}
                />
              </div>
            </Card>
          ))}

          {/* Barra de ações */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
            <div
              className="skeleton-block"
              style={{ width: 190, height: 38, borderRadius: 'var(--radius-md)' }}
            />
            <div
              className="skeleton-block"
              style={{ width: 110, height: 38, borderRadius: 'var(--radius-md)' }}
            />
          </div>
        </div>
      </PageLayout>
    );
  }

  // ─── Fetch error state ──────────────────────────
  if (fetchError) {
    return (
      <PageLayout>
        <PageHeader title="Editar Espelhamento" onBack={handleBack} />
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
          titleId={SUCCESS_TITLE_ID}
          onBack={handleBack}
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
          <p
            style={{
              fontSize: 'var(--text-base)',
              fontWeight: 600,
              color: 'var(--color-success)',
              margin: 0,
            }}
          >
            Espelhamento {isEdit ? 'atualizado' : 'criado'} com sucesso!
          </p>
          <div
            style={{
              display: 'flex',
              gap: '0.75rem',
              marginTop: '0.5rem',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {isEdit ? (
              <>
                <Button variant="secondary" onClick={onBack}>
                  Ver espelhamentos
                </Button>
                <Button variant="ghost" onClick={onBack}>
                  Fechar
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" icon={<Plus size={16} />} onClick={handleCreateAnother}>
                  Criar outro espelhamento
                </Button>
                <Button variant="secondary" onClick={onBack}>
                  Ver espelhamentos
                </Button>
              </>
            )}
          </div>
        </div>
      </PageLayout>
    );
  }

  // ─── Form ───────────────────────────────────────
  return (
    <PageLayout>
      <PageHeader
        title={isEdit ? 'Editar Espelhamento' : 'Novo Espelhamento'}
        subtitle={
          isEdit
            ? 'Altere os campos desejados e salve'
            : 'Configure o espelhamento de ofertas entre grupos'
        }
        onBack={handleBack}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setGroupsRefreshSignal((n) => n + 1)}
            icon={<RotateCw size={14} />}
            title="Recarregar a lista de grupos do WhatsApp, ignorando o cache"
          >
            Atualizar grupos
          </Button>
        }
      />

      <form onSubmit={handleSubmit} noValidate style={{ width: '100%' }}>
        <Card
          title="📋 Informações Básicas"
          titleId={NAME_TITLE_ID}
          role="group"
          aria-labelledby={NAME_TITLE_ID}
          style={{ marginBottom: '1.5rem' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Input
              id={NAME_INPUT_ID}
              ref={nameRef}
              label="Nome do Espelhamento"
              placeholder="Ex: Ofertas Diárias → Grupo VIP"
              value={name}
              onChange={(e) => {
                setName((e.target as HTMLInputElement).value);
                if (nameError) setNameError(null);
              }}
              onBlur={() => validateField('name')}
              error={nameError}
              maxLength={255}
              required
            />
          </div>
        </Card>

        <Card
          title={
            <>
              🔗 Grupos de Origem{' '}
              <span style={{ color: 'var(--color-error)' }} aria-hidden="true">
                *
              </span>
            </>
          }
          titleId={SOURCE_TITLE_ID}
          role="group"
          aria-labelledby={SOURCE_TITLE_ID}
          style={{ marginBottom: '1.5rem', overflow: 'visible' }}
        >
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginTop: 0,
              marginBottom: '0.75rem',
            }}
          >
            Selecione os grupos de onde as ofertas serão capturadas.
          </p>
          <GroupOfferAutocomplete
            token={token}
            value={sourceGroups}
            onChange={(groups) => {
              setSourceGroups(groups);
              if (sourceError) setSourceError(null);
            }}
            inputId={SOURCE_INPUT_ID}
            ariaLabel="Buscar grupo de origem"
            error={sourceError}
            errorId={SOURCE_ERROR_ID}
            onBlur={() => validateField('sourceGroups')}
            inputRef={sourceRef}
            refreshSignal={groupsRefreshSignal}
          />
          {sourceError && (
            <p
              id={SOURCE_ERROR_ID}
              role="alert"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-error)',
                marginTop: '0.4rem',
                marginBottom: 0,
              }}
            >
              {sourceError}
            </p>
          )}
        </Card>

        <Card
          title={
            <>
              🎯 Grupos de Destino{' '}
              <span style={{ color: 'var(--color-error)' }} aria-hidden="true">
                *
              </span>
            </>
          }
          titleId={TARGET_TITLE_ID}
          role="group"
          aria-labelledby={TARGET_TITLE_ID}
          style={{ marginBottom: '1.5rem', overflow: 'visible' }}
        >
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              marginTop: 0,
              marginBottom: '0.75rem',
            }}
          >
            Selecione os grupos para onde as ofertas serão espelhadas.
          </p>
          <GroupDestAutocomplete
            token={token}
            value={targetGroups}
            onChange={(groups) => {
              setTargetGroups(groups);
              if (targetError) setTargetError(null);
            }}
            inputId={TARGET_INPUT_ID}
            ariaLabel="Buscar grupo de destino"
            error={targetError}
            errorId={TARGET_ERROR_ID}
            onBlur={() => validateField('targetGroups')}
            inputRef={targetRef}
            refreshSignal={groupsRefreshSignal}
          />
          {targetError && (
            <p
              id={TARGET_ERROR_ID}
              role="alert"
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-error)',
                marginTop: '0.4rem',
                marginBottom: 0,
              }}
            >
              {targetError}
            </p>
          )}
        </Card>

        {/* ─── TEMPLATE DA MENSAGEM (DESATIVADO TEMPORARIAMENTE) ────────
        <Card title="💬 Template da Mensagem" style={{ marginBottom: '1.5rem' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
            Personalize a mensagem enviada para o grupo de destino.
          </p>

          <TemplateEditor
            value={messageTemplate}
            onChange={setMessageTemplate}
            token={token}
            showDefaultHint={true}
            placeholder="{texto_original}"
          />

          <TemplatePreview
            token={token}
            template={messageTemplate}
            sourceGroupName={sourceGroups[0]?.name}
            targetGroupName={targetGroups[0]?.name}
          />
        </Card>
        ─────────────────────────────────────────────────────────────── */}

        {/* ─── Rate Limit Info Banner (DESATIVADO TEMPORARIAMENTE) ───────
                <Card
                  title="⚠️ Limites de Envio (Rate Limit)"
                  style={{ marginBottom: '1.5rem', borderLeft: '4px solid var(--color-warning)' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: 'var(--text-sm)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--color-warning)', fontSize: '1.1rem', flexShrink: 0 }}>1</span>
                      <div>
                        <strong>Por instância WhatsApp:</strong>{' '}
                        Sua instância WhatsApp tem um limite de <strong>15 mensagens a cada 5 minutos</strong>.
                        Todos os espelhamentos ativos compartilham esse limite.
                        <span style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: '0.2rem' }}>
                          ⏱ Se exceder, as mensagens são enfileiradas automaticamente — nenhuma oferta é perdida, apenas atrasada.
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                      <span style={{ color: 'var(--color-primary)', fontSize: '1.1rem', flexShrink: 0 }}>2</span>
                      <div>
                        <strong>Por grupo de destino (sub-rate):</strong>{' '}
                        Abaixo você pode definir um limite específico para o(s) grupo(s) de destino
                        deste espelhamento. Útil para evitar flooding em grupos muito ativos.
                        <span style={{ color: 'var(--color-text-muted)', display: 'block', marginTop: '0.2rem' }}>
                          💡 Configure abaixo. Deixe em branco para usar o valor padrão (5 msg / 5 min).
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
                ─────────────────────────────────────────────────────────────── */}

        {/* ─── Sub-Rate Limit (DESATIVADO TEMPORARIAMENTE) ──────────────────
                <Card title="📊 Limite por Grupo de Destino" style={{ marginBottom: '1.5rem' }}>
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '0.75rem' }}>
                    Define quantas mensagens este espelhamento pode enviar para cada grupo de destino
                    em uma janela de tempo. Isso é independente do limite geral da instância.
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 200px' }}>
                      <Input
                        label="Máx. mensagens por janela"
                        type="number"
                        placeholder="5"
                        value={subRateMaxMsgs === null ? '' : String(subRateMaxMsgs)}
                        onChange={(e) => {
                          const val = (e.target as HTMLInputElement).value;
                          setSubRateMaxMsgs(val === '' ? null : parseInt(val, 10));
                        }}
                        min={1}
                        max={100}
                        hint="Deixe em branco para usar o padrão (5)"
                      />
                    </div>
                    <div style={{ flex: '1 1 200px' }}>
                      <Input
                        label="Janela (segundos)"
                        type="number"
                        placeholder="300"
                        value={subRateWindowSec === null ? '' : String(subRateWindowSec)}
                        onChange={(e) => {
                          const val = (e.target as HTMLInputElement).value;
                          setSubRateWindowSec(val === '' ? null : parseInt(val, 10));
                        }}
                        min={10}
                        max={3600}
                        step={10}
                        hint="300s = 5 minutos. Mín: 10s, Máx: 3600s"
                      />
                    </div>
                  </div>
                </Card>
                ─────────────────────────────────────────────────────────────── */}

        {/* Submit Error */}
        {submitError && (
          <div
            role="alert"
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

        {/* Actions — barra sticky em mobile (regra .form-actions-bar em globals.css) */}
        <div
          className="form-actions-bar"
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
          <Button type="button" variant="secondary" onClick={handleBack} disabled={saving}>
            Cancelar
          </Button>
        </div>
      </form>
    </PageLayout>
  );
}
