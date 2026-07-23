/**
 * Dashboard do Afiliado
 *
 * Exibe:
 * - Credenciais Shopee (App ID + Secret)
 * - Seção Mercado Livre (conexão OAuth, meliid, melitat)
 * - Teste de conversão
 * - Botão de Sair
 */

import { useState, useEffect, useCallback } from 'react';
import { WppConnection } from './WppConnection.tsx';
import { GroupOfferAutocomplete } from './GroupOfferAutocomplete.tsx';
import { GroupDestAutocomplete } from './GroupDestAutocomplete.tsx';

interface ExcludedGroup {
  groupJid: string;
  groupName: string;
  reason: string;
  ratio: number;
  totalMessages: number;
  validOffers: number;
}

interface ProfileData {
  id: number;
  email: string;
  name: string;
  shopeeConfigured: boolean;
  shopeeAppId: string | null;
  mercadoLivre:
    | { connected: false }
    | { connected: true; nickname: string; mlUserId: string; expired: boolean; hasSessionCookies: boolean; meliid: string | null; melitat: string | null };
  sourceGroups?: { jid: string; name: string }[];
  targetGroups?: { jid: string; name: string }[];
  excludedGroups?: ExcludedGroup[];
  messageTemplate?: string | null;
}

interface AffiliateDashboardProps {
  user: { id: number; email: string; name: string };
  token: string;
  onLogout: () => void;
  onNavigateToLogs?: () => void;
  onNavigateToWorkerStatus?: () => void;
}

/**
 * Sub-componente: Configuração ML (meliid, melitat, cookies)
 */
function MlConfigSection({
  mlUserId,
  meliid: initialMeliid,
  melitat: initialMelitat,
  hasSessionCookies,
  token,
  onUpdate,
}: {
  mlUserId: string;
  meliid: string;
  melitat: string;
  hasSessionCookies: boolean;
  token: string;
  onUpdate: () => void;
}) {
  const [meliid, setMeliid] = useState(initialMeliid);
  const [melitat, setMelitat] = useState(initialMelitat);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await fetch(`/api/ml/affiliates/${mlUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ meliid: meliid || undefined, melitat: melitat || undefined }),
      });
      setSaved(true);
      onUpdate();
      setTimeout(() => setSaved(false), 4000);
    } catch { /* ignore */ }
    setSaving(false);
  }

  return (
    <div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
          MELIID (opcional)
        </label>
        <input
          value={meliid}
          onChange={(e) => setMeliid((e.target as HTMLInputElement).value)}
          placeholder="Formato antigo"
          style={{
            width: '100%',
            padding: '0.5rem 0.625rem',
            borderRadius: '6px',
            border: '1px solid #334155',
            background: '#0f172a',
            color: '#e2e8f0',
            fontSize: '0.85rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ marginBottom: '0.75rem' }}>
        <label style={{ display: 'block', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
          MELITAT (etiqueta)
        </label>
        <input
          value={melitat}
          onChange={(e) => setMelitat((e.target as HTMLInputElement).value)}
          placeholder="Ex: mtorreao"
          style={{
            width: '100%',
            padding: '0.5rem 0.625rem',
            borderRadius: '6px',
            border: '1px solid #334155',
            background: '#0f172a',
            color: '#e2e8f0',
            fontSize: '0.85rem',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{
            padding: '0.4rem 0.75rem',
            borderRadius: '6px',
            border: 'none',
            background: saving ? '#6366f180' : '#6366f1',
            color: 'white',
            fontSize: '0.85rem',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
        {saved && <span style={{ fontSize: '0.8rem', color: '#4ade80' }}>✅</span>}
        <span style={{ fontSize: '0.8rem', color: hasSessionCookies ? '#4ade80' : '#64748b' }}>
          {hasSessionCookies ? '🔗 Cookies OK' : '📎 Sem cookies'}
        </span>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
        Para importar cookies de sessão, use a{' '}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.open('/chrome-cookie-importer', '_blank'); }}
          style={{ color: '#6366f1', textDecoration: 'underline' }}
        >
          extensão Chrome
        </a>
      </div>
    </div>
  );
}

export function AffiliateDashboard({ user, token, onLogout, onNavigateToLogs, onNavigateToWorkerStatus }: AffiliateDashboardProps) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);

  // Form Shopee
  const [shopeeAppId, setShopeeAppId] = useState('');
  const [shopeeAppSecret, setShopeeAppSecret] = useState('');
  const [savingShopee, setSavingShopee] = useState(false);
  const [shopeeSaved, setShopeeSaved] = useState(false);

  // Teste de conversão
  const [testUrl, setTestUrl] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  // Grupos WhatsApp — Configuração de espelhamento
  const [offerGroups, setOfferGroups] = useState<{ jid: string; name: string }[]>([]);
  const [destGroups, setDestGroups] = useState<{ jid: string; name: string }[]>([]);
  const [savingGroups, setSavingGroups] = useState(false);
  const [groupSaveMessage, setGroupSaveMessage] = useState<string | null>(null);
  const [groupSaveError, setGroupSaveError] = useState<string | null>(null);

  // Template de mensagem personalizada
  const [messageTemplate, setMessageTemplate] = useState<string>('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateSaved, setTemplateSaved] = useState(false);

  // Grupos excluídos (persistentes — carregados do profile)
  const [excludedGroups, setExcludedGroups] = useState<ExcludedGroup[]>([]);

  // Validação de ofertas
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{
    validated: boolean;
    report: {
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
    };
  } | null>(null);

  // Ações em grupos excluídos (loading state)
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/affiliate/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { success: boolean; profile: ProfileData };
      if (data.success) {
        setProfile(data.profile);
        setShopeeAppId(data.profile.shopeeAppId || '');
        // Restaura grupos de espelhamento salvos
        if (data.profile.sourceGroups?.length) {
          setOfferGroups(data.profile.sourceGroups);
        }
        if (data.profile.targetGroups?.length) {
          setDestGroups(data.profile.targetGroups);
        }
        // Restaura grupos excluídos
        setExcludedGroups(data.profile.excludedGroups || []);
        // Restaura template de mensagem
        setMessageTemplate(data.profile.messageTemplate || '');
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function handleSaveShopee() {
    setSavingShopee(true);
    setShopeeSaved(false);
    try {
      const res = await fetch('/api/affiliate/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ shopeeAppId, shopeeAppSecret }),
      });
      const data = await res.json() as { success: boolean; message?: string };
      if (data.success) {
        setShopeeSaved(true);
        loadProfile();
        setTimeout(() => setShopeeSaved(false), 4000);
      }
    } catch { /* ignore */ }
    setSavingShopee(false);
  }

  async function handleTestConversion() {
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const res = await fetch('/api/affiliate/test-conversion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ url: testUrl }),
      });
      const data = await res.json() as { success: boolean; affiliateUrl?: string; error?: string };
      if (data.success && data.affiliateUrl) {
        setTestResult(data.affiliateUrl);
      } else {
        setTestError(data.error || 'Falha na conversão');
      }
    } catch {
      setTestError('Erro de conexão');
    }
    setTesting(false);
  }

  async function handleSaveGroups() {
    setGroupSaveError(null);
    setGroupSaveMessage(null);
    setValidationResult(null);

    if (offerGroups.length === 0) {
      setGroupSaveError('Selecione pelo menos 1 grupo de ofertas.');
      return;
    }

    if (destGroups.length === 0) {
      setGroupSaveError('Selecione pelo menos 1 grupo de destino.');
      return;
    }

    // Chama o groups-config diretamente (API faz validação + save parcial + retorna excludedGroups)
    setValidating(true);
    setSavingGroups(true);
    try {
      const res = await fetch('/api/affiliate/groups-config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sourceGroups: offerGroups,
          targetGroups: destGroups,
        }),
      });
      const data = await res.json() as {
        success: boolean;
        message?: string;
        error?: string;
        sourceGroups?: { jid: string; name: string }[];
        excludedGroups?: ExcludedGroup[];
      };

      if (data.success) {
        setGroupSaveMessage(data.message || 'Espelhamento configurado com sucesso');
        // Atualiza grupos excluídos com o retorno da API
        if (data.excludedGroups && data.excludedGroups.length > 0) {
          setExcludedGroups(data.excludedGroups);
        }
        setTimeout(() => setGroupSaveMessage(null), 8000);
      } else {
        setGroupSaveError(data.error || 'Erro ao salvar configuração');
        // Se a API retornou report no erro, exibe as stats de validação
        if ((data as any).report) {
          setValidationResult({
            validated: false,
            report: (data as any).report,
          });
        }
      }
    } catch {
      setGroupSaveError('Erro de conexão ao salvar configuração');
    }
    setValidating(false);
    setSavingGroups(false);
  }

  /**
   * Valida os grupos de ofertas sem salvar (preview).
   * Chama /api/affiliate/validate-groups e exibe stats por grupo.
   */
  async function handleValidatePreview() {
    setGroupSaveError(null);
    setGroupSaveMessage(null);
    setValidationResult(null);

    if (offerGroups.length === 0) {
      setGroupSaveError('Selecione pelo menos 1 grupo de ofertas.');
      return;
    }

    setValidating(true);
    try {
      const res = await fetch('/api/affiliate/validate-groups', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sourceGroups: offerGroups }),
      });
      const data = await res.json() as {
        success: boolean;
        validated?: boolean;
        report?: {
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
        };
        error?: string;
      };

      if (data.success && data.report) {
        setValidationResult({
          validated: data.validated ?? false,
          report: data.report,
        });
      } else {
        setGroupSaveError(data.error || 'Erro ao validar grupos');
      }
    } catch {
      setGroupSaveError('Erro de conexão ao validar grupos');
    }
    setValidating(false);
  }

  /**
   * Revalida um grupo excluído. Se passar, é adicionado ao espelhamento.
   */
  async function handleRevalidateGroup(group: ExcludedGroup) {
    setActionLoading(group.groupJid);
    setGroupSaveError(null);
    setGroupSaveMessage(null);
    try {
      const res = await fetch('/api/affiliate/revalidate-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ groupJid: group.groupJid, groupName: group.groupName }),
      });
      const data = await res.json() as {
        success: boolean;
        passed: boolean;
        message: string;
        report?: {
          groupJid: string;
          groupName: string;
          totalMessages: number;
          validOffers: number;
          ratio: number;
          passed: boolean;
          errors: string[];
        };
      };

      if (data.success && data.passed) {
        // Grupo revalidado e adicionado — recarrega o profile
        await loadProfile();
        setGroupSaveMessage(data.message);
        setTimeout(() => setGroupSaveMessage(null), 8000);
      } else {
        // Ainda não passou — atualiza a info do excluded group
        if (data.report) {
          setExcludedGroups((prev) =>
            prev.map((eg) =>
              eg.groupJid === group.groupJid
                ? {
                    ...eg,
                    ratio: data.report!.ratio,
                    totalMessages: data.report!.totalMessages,
                    validOffers: data.report!.validOffers,
                    reason: `Apenas ${Math.round(data.report!.ratio * 100)}% de ofertas válidas (mínimo 50%)`,
                  }
                : eg
            )
          );
        }
        setGroupSaveError(data.message);
      }
    } catch {
      setGroupSaveError('Erro ao revalidar grupo');
    }
    setActionLoading(null);
  }

  /**
   * Salva o template de mensagem personalizada.
   */
  async function handleSaveTemplate() {
    setSavingTemplate(true);
    setTemplateSaved(false);
    try {
      const res = await fetch('/api/affiliate/message-template', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messageTemplate: messageTemplate || null }),
      });
      const data = await res.json() as { success: boolean; message?: string };
      if (data.success) {
        setTemplateSaved(true);
        setTimeout(() => setTemplateSaved(false), 4000);
      }
    } catch { /* ignore */ }
    setSavingTemplate(false);
  }

  /**
   * Força a ativação de um grupo excluído.
   */
  async function handleForceGroup(group: ExcludedGroup) {
    setActionLoading(group.groupJid);
    setGroupSaveError(null);
    setGroupSaveMessage(null);
    try {
      const res = await fetch('/api/affiliate/force-group', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ groupJid: group.groupJid, groupName: group.groupName }),
      });
      const data = await res.json() as { success: boolean; message: string; error?: string };

      if (data.success) {
        // Remove dos excluded e recarrega
        await loadProfile();
        setGroupSaveMessage(data.message);
        setTimeout(() => setGroupSaveMessage(null), 8000);
      } else {
        setGroupSaveError(data.error || 'Erro ao ativar grupo');
      }
    } catch {
      setGroupSaveError('Erro ao ativar grupo');
    }
    setActionLoading(null);
  }

  function handleConnectML() {
    window.location.href = `/api/ml/auth?userId=${user.id}`;
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        Carregando...
      </div>
    );
  }

  const mlConnected = profile?.mercadoLivre.connected === true;

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '2rem 1rem',
    }}>
      {/* Header */}
      <div style={{ maxWidth: '720px', margin: '0 auto 2rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img src="/logos/logo_full_square.png" alt="O Mestre Afiliado" style={{ width: '48px', height: '48px' }} />
            <div>
              <h1 style={{ margin: 0, fontSize: '1.3rem' }}>O Mestre Afiliado</h1>
              <p style={{ margin: 0, fontSize: '0.85rem', color: '#94a3b8' }}>Olá, {user.name}</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button
              onClick={onNavigateToLogs || (() => {})}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #6366f1',
                background: 'transparent',
                color: '#a5b4fc',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              📋 Logs
            </button>
            <button
              onClick={onNavigateToWorkerStatus || (() => {})}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #10b981',
                background: 'transparent',
                color: '#6ee7b7',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Status
            </button>
            <button
              onClick={onLogout}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #475569',
                background: 'transparent',
                color: '#94a3b8',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Sair
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

        {/* Card: Shopee Credentials */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>🛒 Shopee</span>
            <span style={{ fontSize: '0.8rem', color: profile?.shopeeConfigured ? '#4ade80' : '#f87171' }}>
              {profile?.shopeeConfigured ? '✅ Configurado' : '❌ Não configurado'}
            </span>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                App ID
              </label>
              <input
                value={shopeeAppId}
                onChange={(e) => setShopeeAppId((e.target as HTMLInputElement).value)}
                placeholder="Seu App ID da Shopee"
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                App Secret
              </label>
              <input
                type="password"
                value={shopeeAppSecret}
                onChange={(e) => setShopeeAppSecret((e.target as HTMLInputElement).value)}
                placeholder="Seu App Secret da Shopee"
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                onClick={handleSaveShopee}
                disabled={savingShopee}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: savingShopee ? '#6366f180' : '#6366f1',
                  color: 'white',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: savingShopee ? 'not-allowed' : 'pointer',
                }}
              >
                {savingShopee ? 'Salvando...' : 'Salvar'}
              </button>
              {shopeeSaved && <span style={{ fontSize: '0.85rem', color: '#4ade80' }}>✅ Salvo!</span>}
            </div>
          </div>
        </div>

        {/* Card: Mercado Livre */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>📦 Mercado Livre</span>
            <span style={{ fontSize: '0.8rem', color: mlConnected ? '#4ade80' : '#f87171' }}>
              {mlConnected ? '✅ Conectado' : '❌ Não conectado'}
            </span>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            {mlConnected ? (
              <div>
                <div style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                  Conectado como <strong>{(profile!.mercadoLivre as { nickname: string }).nickname}</strong>
                  {(profile!.mercadoLivre as { expired: boolean }).expired && (
                    <span style={{ marginLeft: '0.5rem', color: '#f87171', fontSize: '0.8rem' }}>(token expirado)</span>
                  )}
                </div>

                {/* meliid / melitat */}
                <MlConfigSection
                  mlUserId={(profile!.mercadoLivre as { mlUserId: string }).mlUserId}
                  meliid={(profile!.mercadoLivre as { meliid: string | null }).meliid || ''}
                  melitat={(profile!.mercadoLivre as { melitat: string | null }).melitat || ''}
                  hasSessionCookies={(profile!.mercadoLivre as { hasSessionCookies: boolean }).hasSessionCookies}
                  token={token}
                  onUpdate={loadProfile}
                />
              </div>
            ) : (
              <div>
                <p style={{ margin: '0 0 1rem', fontSize: '0.9rem', color: '#94a3b8' }}>
                  Conecte sua conta do Mercado Livre para gerar links de afiliado.
                </p>
                <button
                  onClick={handleConnectML}
                  style={{
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid #fff059',
                    background: 'transparent',
                    color: '#fff059',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    fontWeight: 500,
                  }}
                >
                  + Conectar conta ML
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Card: Testar Conversão */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>🧪 Testar Conversão</span>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <input
                type="url"
                value={testUrl}
                onChange={(e) => setTestUrl((e.target as HTMLInputElement).value)}
                placeholder="Cole a URL do produto (Shopee ou ML)..."
                style={{
                  flex: 1,
                  padding: '0.625rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              />
              <button
                onClick={handleTestConversion}
                disabled={testing || !testUrl}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: testing || !testUrl ? '#6366f180' : '#6366f1',
                  color: 'white',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: testing || !testUrl ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {testing ? 'Testando...' : 'Testar'}
              </button>
            </div>

            {testError && (
              <div style={{
                padding: '0.75rem 1rem',
                background: '#7f1d1d',
                borderRadius: '8px',
                border: '1px solid #991b1b',
                color: '#fca5a5',
                fontSize: '0.85rem',
              }}>
                ❌ {testError}
              </div>
            )}

            {testResult && (
              <div style={{
                background: '#0f172a',
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                border: '1px solid #4ade8040',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
              }}>
                <code style={{
                  flex: 1,
                  fontSize: '0.85rem',
                  wordBreak: 'break-all',
                  color: '#a5b4fc',
                }}>
                  {testResult}
                </code>
                <button
                  onClick={() => copyToClipboard(testResult)}
                  style={{
                    padding: '0.4rem 0.6rem',
                    borderRadius: '6px',
                    border: '1px solid #334155',
                    background: '#1e293b',
                    color: '#e2e8f0',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Copiar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Card: Grupos de Ofertas (1-3) */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>📢 Grupos de Ofertas</span>
            <span style={{ fontSize: '0.8rem', color: offerGroups.length > 0 ? '#4ade80' : '#f87171' }}>
              {offerGroups.length > 0 ? `${offerGroups.length} selecionado(s)` : 'Nenhum selecionado'}
            </span>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
              Selecione de 1 a 3 grupos onde as ofertas serão monitoradas.
            </div>
            <GroupOfferAutocomplete
              token={token}
              value={offerGroups}
              onChange={setOfferGroups}
            />
          </div>
        </div>

        {/* Card: Grupos de Destino (1 ou mais) */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>🎯 Grupos de Destino</span>
            <span style={{ fontSize: '0.8rem', color: destGroups.length > 0 ? '#4ade80' : '#f87171' }}>
              {destGroups.length > 0 ? `${destGroups.length} selecionado(s)` : 'Nenhum'}
            </span>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
              Selecione pelo menos 1 grupo para onde as ofertas serão espelhadas.
            </div>
            <GroupDestAutocomplete
              token={token}
              value={destGroups}
              onChange={setDestGroups}
            />
          </div>
        </div>

        {/* Card: Confirmar Configuração */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>✅ Confirmar Espelhamento</span>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
              {offerGroups.length > 0 && destGroups.length > 0 ? (
                <>Monitorando <strong>{offerGroups.length}</strong> grupo(s) de ofertas → enviando para <strong>{destGroups.map((g) => g.name).join(', ')}</strong></>
              ) : (
                <>Configure os grupos acima para ativar o espelhamento de ofertas.</>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button
                onClick={handleValidatePreview}
                disabled={validating || offerGroups.length === 0}
                style={{
                  padding: '0.6rem 1.25rem',
                  borderRadius: '8px',
                  border: '1px solid #f59e0b',
                  background: validating || offerGroups.length === 0 ? '#78350f80' : 'transparent',
                  color: '#fbbf24',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: validating || offerGroups.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                {validating ? 'Validando...' : '🔍 Validar'}
              </button>
              <button
                onClick={handleSaveGroups}
                disabled={savingGroups || offerGroups.length === 0 || destGroups.length === 0}
                style={{
                  padding: '0.6rem 1.25rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: savingGroups || offerGroups.length === 0 || destGroups.length === 0
                    ? '#6366f180' : '#6366f1',
                  color: 'white',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: savingGroups || offerGroups.length === 0 || destGroups.length === 0
                    ? 'not-allowed' : 'pointer',
                }}
              >
                {savingGroups ? 'Configurando...' : 'Confirmar'}
              </button>
            </div>

            {/* Erro */}
            {groupSaveError && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem 1rem',
                background: '#7f1d1d',
                borderRadius: '8px',
                border: '1px solid #991b1b',
                color: '#fca5a5',
                fontSize: '0.85rem',
              }}>
                ❌ {groupSaveError}
              </div>
            )}

            {/* Sucesso */}
            {groupSaveMessage && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.75rem 1rem',
                background: '#14532d',
                borderRadius: '8px',
                border: '1px solid #22c55e40',
                color: '#4ade80',
                fontSize: '0.85rem',
              }}>
                ✅ {groupSaveMessage}
              </div>
            )}

            {/* Validação: per-group stats */}
            {validationResult && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  background: validationResult.validated ? '#0f172a' : '#1a1a2e',
                  border: `1px solid ${validationResult.validated ? '#22c55e40' : '#f59e0b40'}`,
                  marginBottom: '0.75rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                      📊 Resultado da Validação
                    </span>
                    <span style={{
                      fontSize: '0.8rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      background: validationResult.validated ? '#14532d' : '#78350f',
                      color: validationResult.validated ? '#4ade80' : '#fbbf24',
                    }}>
                      {validationResult.validated ? '✅ OK' : '⚠️ Atenção'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.85rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                    <span>📨 {validationResult.report.totalMessages} mensagens</span>
                    <span>✅ {validationResult.report.totalValidOffers} ofertas válidas</span>
                    <span>📊 {Math.round(validationResult.report.overallRatio * 100)}% taxa geral</span>
                  </div>
                </div>

                {/* Per-group cards */}
                {validationResult.report.groups.map((group, idx) => (
                  <div
                    key={group.groupJid || idx}
                    style={{
                      padding: '0.75rem 1rem',
                      marginBottom: '0.5rem',
                      borderRadius: '8px',
                      background: group.passed ? '#0f172a' : '#451a1a',
                      border: `1px solid ${group.passed ? '#22c55e40' : '#991b1b'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem', color: group.passed ? '#4ade80' : '#fca5a5' }}>
                        {group.passed ? '✅' : '❌'} {group.groupName}
                      </span>
                      <span style={{
                        fontSize: '0.8rem',
                        padding: '0.15rem 0.4rem',
                        borderRadius: '4px',
                        background: group.passed ? '#14532d' : '#7f1d1d',
                        color: group.passed ? '#4ade80' : '#fca5a5',
                      }}>
                        {Math.round(group.ratio * 100)}%
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                      <span>📨 {group.totalMessages} msgs</span>
                      <span>✅ {group.validOffers} ofertas</span>
                      <span>
                        {group.passed
                          ? '✔️ Acima de 50%'
                          : `⚠️ Apenas ${Math.round(group.ratio * 100)}% (mín. 50%)`
                        }
                      </span>
                    </div>
                    {group.errors.length > 0 && (
                      <div style={{ marginTop: '0.35rem', fontSize: '0.75rem', color: '#f87171' }}>
                        {group.errors.map((e, i) => <div key={i}>⚠️ {e}</div>)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Card: Template de Mensagem Personalizado */}
        <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>💬 Template de Mensagem</span>
            <span style={{ fontSize: '0.8rem', color: messageTemplate ? '#4ade80' : '#94a3b8' }}>
              {messageTemplate ? '✅ Personalizado' : '📝 Padrão'}
            </span>
          </div>
          <div style={{ padding: '1rem 1.25rem' }}>
            <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.75rem' }}>
              Personalize a mensagem enviada para o grupo de destino.
              Use os placeholders abaixo para inserir o conteúdo original.
            </div>

            {/* Placeholder legend */}
            <div style={{
              background: '#0f172a',
              borderRadius: '8px',
              padding: '0.75rem',
              marginBottom: '0.75rem',
              fontSize: '0.8rem',
              color: '#94a3b8',
              border: '1px solid #334155',
            }}>
              <code style={{ color: '#a5b4fc' }}>{'{texto_original}'}</code> — Texto original com link convertido<br />
              <code style={{ color: '#a5b4fc' }}>{'{link_convertido}'}</code> — Apenas o link de afiliado
            </div>

            <textarea
              value={messageTemplate}
              onChange={(e) => setMessageTemplate((e.target as HTMLTextAreaElement).value)}
              placeholder='{texto_original}'
              rows={5}
              style={{
                width: '100%',
                padding: '0.625rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.9rem',
                fontFamily: 'monospace',
                outline: 'none',
                resize: 'vertical',
                boxSizing: 'border-box',
                lineHeight: '1.5',
              }}
            />

            {/* Preview */}
            {messageTemplate && (
              <div style={{
                marginTop: '0.75rem',
                padding: '0.625rem 0.75rem',
                borderRadius: '8px',
                background: '#0f172a',
                border: '1px solid #334155',
                fontSize: '0.8rem',
                color: '#94a3b8',
              }}>
                <div style={{ marginBottom: '0.25rem', color: '#64748b' }}>Pré-visualização:</div>
                <div style={{ color: '#e2e8f0', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                  {messageTemplate
                    .replace('{texto_original}', '🔗 Confira esta oferta: https://exemplo.com/produto')
                    .replace('{link_convertido}', 'https://exemplo.com/produto')}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.75rem' }}>
              <button
                onClick={handleSaveTemplate}
                disabled={savingTemplate}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: savingTemplate ? '#6366f180' : '#6366f1',
                  color: 'white',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  cursor: savingTemplate ? 'not-allowed' : 'pointer',
                }}
              >
                {savingTemplate ? 'Salvando...' : 'Salvar Template'}
              </button>
              {templateSaved && <span style={{ fontSize: '0.85rem', color: '#4ade80' }}>✅ Salvo!</span>}
            </div>
          </div>
        </div>

        {/* Card: Grupos Excluídos (persistente) */}
        {excludedGroups.length > 0 && (
          <div style={{ background: '#1e293b', borderRadius: '12px', border: '1px solid #334155', overflow: 'hidden' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>⚠️ Grupos Desativados</span>
              <span style={{ fontSize: '0.8rem', color: '#f87171' }}>
                {excludedGroups.length} desativado(s)
              </span>
            </div>
            <div style={{ padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '1rem' }}>
                Estes grupos foram desativados por não atingirem o mínimo de 50% de ofertas válidas.
              </div>
              {excludedGroups.map((group) => (
                <div
                  key={group.groupJid}
                  style={{
                    padding: '0.75rem',
                    marginBottom: '0.75rem',
                    borderRadius: '8px',
                    background: '#451a1a',
                    border: '1px solid #991b1b',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fca5a5', marginBottom: '0.25rem' }}>
                        {group.groupName}
                      </div>
                      <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#94a3b8', marginBottom: '0.35rem', flexWrap: 'wrap' }}>
                        <span>📊 {Math.round(group.ratio * 100)}% de ofertas</span>
                        <span>✅ {group.validOffers} de {group.totalMessages} válidas</span>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#f87171' }}>
                        {group.reason}
                      </div>
                    </div>
                  </div>

                  {/* Ações */}
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button
                      onClick={() => handleRevalidateGroup(group)}
                      disabled={actionLoading === group.groupJid}
                      style={{
                        padding: '0.35rem 0.6rem',
                        borderRadius: '6px',
                        border: '1px solid #3b82f6',
                        background: actionLoading === group.groupJid ? '#1e3a5f' : 'transparent',
                        color: '#93c5fd',
                        fontSize: '0.8rem',
                        cursor: actionLoading === group.groupJid ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {actionLoading === group.groupJid ? '⏳' : '🔄 Revalidar'}
                    </button>
                    <button
                      onClick={() => handleForceGroup(group)}
                      disabled={actionLoading === group.groupJid}
                      style={{
                        padding: '0.35rem 0.6rem',
                        borderRadius: '6px',
                        border: '1px solid #f59e0b',
                        background: actionLoading === group.groupJid ? '#78350f' : 'transparent',
                        color: '#fbbf24',
                        fontSize: '0.8rem',
                        cursor: actionLoading === group.groupJid ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {actionLoading === group.groupJid ? '⏳' : '⚡ Ativar mesmo assim'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Card: WhatsApp Connection */}
        <WppConnection token={token} />

      </div>
    </div>
  );
}
