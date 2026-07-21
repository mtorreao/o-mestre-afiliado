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

interface ProfileData {
  id: number;
  email: string;
  name: string;
  shopeeConfigured: boolean;
  shopeeAppId: string | null;
  mercadoLivre:
    | { connected: false }
    | { connected: true; nickname: string; mlUserId: string; expired: boolean; hasSessionCookies: boolean; meliid: string | null; melitat: string | null };
}

interface AffiliateDashboardProps {
  user: { id: number; email: string; name: string };
  token: string;
  onLogout: () => void;
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
      setTimeout(() => setSaved(false), 2000);
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

export function AffiliateDashboard({ user, token, onLogout }: AffiliateDashboardProps) {
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

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch('/api/affiliate/profile', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { success: boolean; profile: ProfileData };
      if (data.success) {
        setProfile(data.profile);
        setShopeeAppId(data.profile.shopeeAppId || '');
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
        setTimeout(() => setShopeeSaved(false), 2000);
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
      </div>
    </div>
  );
}
