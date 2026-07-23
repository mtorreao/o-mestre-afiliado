/**
 * MirrorConfigSection — Configuração de espelhamento de grupos
 *
 * Combina: grupos de ofertas, grupos de destino, validação e confirmação.
 */
import { useState, useEffect } from 'react';
import { Card, Button, Badge } from '../../components/ui/index.ts';
import { Search, Check, AlertTriangle, RefreshCw } from 'lucide-react';
import { GroupOfferAutocomplete } from '../../components/GroupOfferAutocomplete.tsx';
import { GroupDestAutocomplete } from '../../components/GroupDestAutocomplete.tsx';

interface ValidationReport {
  overallRatio: number;
  totalMessages: number;
  totalValidOffers: number;
  groups: {
    groupJid?: string;
    groupName: string;
    totalMessages: number;
    validOffers: number;
    ratio: number;
    passed: boolean;
    errors: string[];
  }[];
}

interface MirrorConfigSectionProps {
  token: string;
  onUpdate: () => void;
  initialOfferGroups?: { jid: string; name: string }[];
  initialDestGroups?: { jid: string; name: string }[];
}

export function MirrorConfigSection({ token, onUpdate, initialOfferGroups = [], initialDestGroups = [] }: MirrorConfigSectionProps) {
  const [offerGroups, setOfferGroups] = useState<{ jid: string; name: string }[]>(initialOfferGroups);
  const [destGroups, setDestGroups] = useState<{ jid: string; name: string }[]>(initialDestGroups);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationResult, setValidationResult] = useState<{ validated: boolean; report: ValidationReport } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Sincroniza estado local quando os dados persistidos são recarregados
  useEffect(() => {
    setOfferGroups(initialOfferGroups);
  }, [initialOfferGroups]);

  useEffect(() => {
    setDestGroups(initialDestGroups);
  }, [initialDestGroups]);

  function handleRefresh() {
    setRefreshKey((k) => k + 1);
  }

  async function handleValidate() {
    setError(null);
    setMessage(null);
    setValidationResult(null);

    if (offerGroups.length === 0) {
      setError('Selecione pelo menos 1 grupo de ofertas.');
      return;
    }

    setValidating(true);
    try {
      const res = await fetch('/api/affiliate/validate-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceGroups: offerGroups }),
      });
      const data = await res.json() as {
        success: boolean;
        validated?: boolean;
        report?: ValidationReport;
        error?: string;
      };

      if (data.success && data.report) {
        setValidationResult({ validated: data.validated ?? false, report: data.report });
      } else {
        setError(data.error || 'Erro ao validar grupos');
      }
    } catch {
      setError('Erro de conexão ao validar');
    }
    setValidating(false);
  }

  async function handleSave() {
    setError(null);
    setMessage(null);
    setValidationResult(null);

    if (offerGroups.length === 0) {
      setError('Selecione pelo menos 1 grupo de ofertas.');
      return;
    }
    if (destGroups.length === 0) {
      setError('Selecione pelo menos 1 grupo de destino.');
      return;
    }

    setValidating(true);
    setSaving(true);
    try {
      const res = await fetch('/api/affiliate/groups-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sourceGroups: offerGroups, targetGroups: destGroups }),
      });
      const data = await res.json() as {
        success: boolean;
        message?: string;
        error?: string;
        excludedGroups?: any[];
        report?: ValidationReport;
      };

      if (data.success) {
        setMessage(data.message || 'Espelhamento configurado com sucesso');
        onUpdate();
        setTimeout(() => setMessage(null), 8000);
      } else {
        setError(data.error || 'Erro ao salvar configuração');
        if ((data as any).report) {
          setValidationResult({ validated: false, report: (data as any).report });
        }
      }
    } catch {
      setError('Erro de conexão ao salvar');
    }
    setValidating(false);
    setSaving(false);
  }

  return (
    <Card title="📢 Configuração de Espelhamento">
      {/* Offer Groups */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.35rem' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Grupos de Ofertas
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge variant={offerGroups.length > 0 ? 'success' : 'neutral'}>
              {offerGroups.length > 0 ? `${offerGroups.length} selecionado(s)` : 'Nenhum'}
            </Badge>
            <button
              onClick={handleRefresh}
              title="Atualizar lista de grupos"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)',
                transition: 'color var(--transition-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Selecione de 1 a 3 grupos onde as ofertas serão monitoradas.
        </p>
        <GroupOfferAutocomplete token={token} value={offerGroups} onChange={setOfferGroups} refreshSignal={refreshKey} />
      </div>

      {/* Destination Groups */}
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.35rem' }}>
          <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Grupos de Destino
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Badge variant={destGroups.length > 0 ? 'success' : 'neutral'}>
              {destGroups.length > 0 ? `${destGroups.length} selecionado(s)` : 'Nenhum'}
            </Badge>
            <button
              onClick={handleRefresh}
              title="Atualizar lista de grupos"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--color-text-muted)',
                padding: '0.25rem',
                display: 'flex',
                alignItems: 'center',
                borderRadius: 'var(--radius-sm)',
                transition: 'color var(--transition-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; }}
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
          Selecione pelo menos 1 grupo para onde as ofertas serão espelhadas.
        </p>
        <GroupDestAutocomplete token={token} value={destGroups} onChange={setDestGroups} refreshSignal={refreshKey} />
      </div>

      {/* Summary & Actions */}
      <div style={{ padding: '0.75rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border-light)', marginBottom: '1rem' }}>
        <p style={{ fontSize: 'var(--text-sm)', margin: 0, color: 'var(--color-text-secondary)', wordBreak: 'break-word' }}>
          {offerGroups.length > 0 && destGroups.length > 0 ? (
            <>Monitorando <strong>{offerGroups.length}</strong> grupo(s) de ofertas → enviando para <strong>{destGroups.map((g) => g.name).join(', ')}</strong></>
          ) : (
            <>Configure os grupos acima para ativar o espelhamento de ofertas.</>
          )}
        </p>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="outline"
          onClick={handleValidate}
          loading={validating}
          disabled={offerGroups.length === 0}
          icon={<Search size={16} />}
        >
          Validar
        </Button>
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={offerGroups.length === 0 || destGroups.length === 0}
          icon={<Check size={16} />}
        >
          Confirmar
        </Button>
      </div>

      {error && (
        <div
          style={{
            marginTop: '0.75rem',
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
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {message && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem 1rem',
            background: 'var(--color-success-subtle)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-success-light)',
            color: 'var(--color-success)',
            fontSize: 'var(--text-sm)',
          }}
        >
          ✅ {message}
        </div>
      )}

      {/* Validation result */}
      {validationResult && (
        <div style={{ marginTop: '1rem' }}>
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: 'var(--radius-md)',
              background: validationResult.validated ? 'var(--color-success-subtle)' : 'var(--color-warning-subtle)',
              border: `1px solid ${validationResult.validated ? 'var(--color-success-light)' : 'var(--color-warning-light)'}`,
              marginBottom: '0.75rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                📊 Resultado da Validação
              </span>
              <Badge variant={validationResult.validated ? 'success' : 'warning'}>
                {validationResult.validated ? '✅ OK' : '⚠️ Atenção'}
              </Badge>
            </div>
            <div style={{ display: 'flex', gap: '1.5rem', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
              <span>📨 {validationResult.report.totalMessages} mensagens</span>
              <span>✅ {validationResult.report.totalValidOffers} ofertas válidas</span>
              <span>📊 {Math.round(validationResult.report.overallRatio * 100)}% taxa geral</span>
            </div>
          </div>

          {validationResult.report.groups.map((group, idx) => (
            <div
              key={group.groupJid || idx}
              style={{
                padding: '0.75rem 1rem',
                marginBottom: '0.5rem',
                borderRadius: 'var(--radius-md)',
                background: group.passed ? 'var(--color-success-subtle)' : 'var(--color-error-subtle)',
                border: `1px solid ${group.passed ? 'var(--color-success-light)' : 'var(--color-error-light)'}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem', flexWrap: 'wrap', gap: '0.35rem' }}>
                <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: group.passed ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {group.passed ? '✅' : '❌'} {group.groupName}
                </span>
                <Badge variant={group.passed ? 'success' : 'error'}>
                  {Math.round(group.ratio * 100)}%
                </Badge>
              </div>
              <div style={{ display: 'flex', gap: '1rem', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                <span>📨 {group.totalMessages} msgs</span>
                <span>✅ {group.validOffers} ofertas</span>
                <span>
                  {group.passed
                    ? '✔️ Acima de 70%'
                    : `⚠️ Apenas ${Math.round(group.ratio * 100)}% (mín. 70%)`
                  }
                </span>
              </div>
              {group.errors.length > 0 && (
                <div style={{ marginTop: '0.35rem', fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>
                  {group.errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
