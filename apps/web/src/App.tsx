/**
 * O Mestre Afiliado — Web App
 *
 * Interface React para conversão de links de afiliados
 * com suporte a múltiplos afiliados do Mercado Livre.
 */

import { useState, useEffect, useCallback } from 'react';

type Marketplace = 'shopee' | 'mercadolivre' | 'unknown';

interface ConversionResult {
  success: boolean;
  originalUrl: string;
  affiliateUrl: string | null;
  marketplace: Marketplace;
  method: string;
  error?: string;
}

interface AffiliateInfo {
  mlUserId: string;
  nickname: string;
  connectedAt: string;
  lastUsedAt: string;
  expiresAt: string;
  expired: boolean;
  meliid: string | null;
  melitat: string | null;
  hasSessionCookies: boolean;
}

const MARKETPLACE_NAMES: Record<Marketplace, string> = {
  shopee: 'Shopee',
  mercadolivre: 'Mercado Livre',
  unknown: 'Desconhecido',
};

const MARKETPLACE_COLORS: Record<Marketplace, string> = {
  shopee: '#ee4d2d',
  mercadolivre: '#fff059',
  unknown: '#666',
};

function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ConversionResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado multi-afiliado
  const [affiliates, setAffiliates] = useState<AffiliateInfo[]>([]);
  const [selectedAffiliate, setSelectedAffiliate] = useState<string>('');
  const [mlConnectedMsg, setMlConnectedMsg] = useState<string | null>(null);

  // Modal de configuração
  const [configModal, setConfigModal] = useState<{
    open: boolean;
    mlUserId: string;
    nickname: string;
    meliid: string;
    melitat: string;
    sessionCookies: string;
  }>({ open: false, mlUserId: '', nickname: '', meliid: '', melitat: '', sessionCookies: '' });

  // Carregar afiliados ao montar
  const loadAffiliates = useCallback(async () => {
    try {
      const res = await fetch('/api/ml/affiliates');
      const data = await res.json() as { success: boolean; affiliates: AffiliateInfo[] };
      if (data.success) {
        setAffiliates(data.affiliates);
        if (!selectedAffiliate && data.affiliates.length > 0) {
          setSelectedAffiliate(data.affiliates[0]!.mlUserId);
        }
      }
    } catch { /* ignora */ }
  }, [selectedAffiliate]);

  useEffect(() => {
    loadAffiliates();

    // Verificar se veio de callback OAuth
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('ml_connected');
    if (connected) {
      setMlConnectedMsg(`✅ Conta Mercado Livre conectada! (ID: ${connected})`);
      // Limpar URL
      window.history.replaceState({}, '', '/');
      loadAffiliates();
    }
  }, [loadAffiliates]);

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    const marketplace = detectMarketplace(url);

    try {
      if (marketplace === 'mercadolivre' && selectedAffiliate) {
        // Usar meliid/melitat do afiliado
        const res = await fetch('/api/ml/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, mlUserId: selectedAffiliate }),
        });
        const data = await res.json() as ConversionResult & { error?: string };
        if (data.error) {
          setError(data.error);
        } else {
          setResult(data);
        }
      } else {
        // Fallback: API padrão
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const data = await res.json() as ConversionResult & { error?: string };
        if (data.error) {
          setError(data.error);
        } else {
          setResult(data);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de conexão');
    } finally {
      setLoading(false);
    }
  }

  function detectMarketplace(u: string): Marketplace {
    if (/shopee\.com\.br/i.test(u)) return 'shopee';
    if (/mercadolivre\.com\.br/i.test(u) || /meli\.la/i.test(u)) return 'mercadolivre';
    return 'unknown';
  }

  function handleConnectML() {
    window.location.href = '/api/ml/auth';
  }

  function openConfig(a: AffiliateInfo) {
    setConfigModal({
      open: true,
      mlUserId: a.mlUserId,
      nickname: a.nickname,
      meliid: a.meliid || '',
      melitat: a.melitat || '',
      sessionCookies: '',
    });
  }

  async function saveConfig() {
    const { mlUserId, meliid, melitat, sessionCookies } = configModal;
    const body: Record<string, string | undefined> = {
      meliid: meliid || undefined,
      melitat: melitat || undefined,
    };
    if (sessionCookies) body.sessionCookies = sessionCookies;
    try {
      const res = await fetch(`/api/ml/affiliates/${mlUserId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setConfigModal({ ...configModal, open: false });
        loadAffiliates();
      } else {
        alert(data.error || 'Erro ao salvar');
      }
    } catch {
      alert('Erro de conexão ao salvar');
    }
  }

  const mpColor = result
    ? MARKETPLACE_COLORS[result.marketplace]
    : '#4f46e5';

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      color: '#e2e8f0',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '2rem 1rem',
    }}>
      {/* Header */}
      <header style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <img
          src="/logos/logo_full_square.png"
          alt="O Mestre Afiliado"
          style={{
            width: '120px',
            height: '120px',
            marginBottom: '0.5rem',
          }}
        />
        <p style={{ color: '#94a3b8', fontSize: '1.1rem', margin: 0 }}>
          Converta links de produtos em links de afiliado
        </p>
      </header>

      {/* Cards de marketplace */}
      <div style={{
        display: 'flex',
        gap: '1rem',
        marginBottom: '2rem',
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}>
        {(['shopee', 'mercadolivre'] as Marketplace[]).map((mp) => (
          <div key={mp} style={{
            background: '#1e293b',
            border: `1px solid ${MARKETPLACE_COLORS[mp]}40`,
            borderRadius: '12px',
            padding: '0.75rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.9rem',
          }}>
            <span style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: MARKETPLACE_COLORS[mp],
              display: 'inline-block',
            }} />
            {MARKETPLACE_NAMES[mp]}
          </div>
        ))}
      </div>

      {/* Mensagem de conexão OAuth */}
      {mlConnectedMsg && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.75rem 1.25rem',
          background: '#14532d',
          borderRadius: '12px',
          border: '1px solid #166534',
          color: '#86efac',
          fontSize: '0.95rem',
          width: '100%',
          maxWidth: '640px',
        }}>
          {mlConnectedMsg}
        </div>
      )}

      {/* Seção: Afiliados ML */}
      <div style={{
        width: '100%',
        maxWidth: '640px',
        marginBottom: '1.5rem',
        background: '#1e293b',
        borderRadius: '12px',
        border: '1px solid #334155',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '0.75rem 1.25rem',
          borderBottom: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>
            🤝 Afiliados Mercado Livre
          </span>
          <button
            onClick={handleConnectML}
            style={{
              padding: '0.4rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #fff059',
              background: 'transparent',
              color: '#fff059',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            + Conectar
          </button>
        </div>

        {affiliates.length === 0 ? (
          <div style={{ padding: '1.5rem 1.25rem', color: '#64748b', textAlign: 'center', fontSize: '0.9rem' }}>
            Nenhum afiliado conectado ainda.
            <br />
            Clique em <strong style={{ color: '#fff059' }}>+ Conectar</strong> para adicionar uma conta do Mercado Livre.
          </div>
        ) : (
          <div style={{ padding: '0.75rem 1.25rem' }}>
            {affiliates.map((a) => {
              const hasParams = a.melitat;
              const hasCookies = a.hasSessionCookies;
              return (
                <label
                  key={a.mlUserId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.5rem 0',
                    cursor: 'pointer',
                    borderBottom: '1px solid #1e293b',
                  }}
                >
                  <input
                    type="radio"
                    name="affiliate"
                    value={a.mlUserId}
                    checked={selectedAffiliate === a.mlUserId}
                    onChange={() => setSelectedAffiliate(a.mlUserId)}
                    style={{ accentColor: '#fff059' }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>
                      {a.nickname}
                      {!hasParams && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#f87171' }}>
                          (sem melitat)
                        </span>
                      )}
                      {a.expired && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#f87171' }}>
                          (token expirado)
                        </span>
                      )}
                      {hasCookies && (
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.75rem', color: '#4ade80' }}>
                          🔗 link curto
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      ID: {a.mlUserId} · Conectado: {new Date(a.connectedAt).toLocaleString('pt-BR')}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.preventDefault(); openConfig(a); }}
                    style={{
                      padding: '0.3rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid #475569',
                      background: 'transparent',
                      color: '#94a3b8',
                      fontSize: '0.75rem',
                      cursor: 'pointer',
                    }}
                  >
                    Configurar
                  </button>
                  <div style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: hasParams ? (a.expired ? '#f87171' : '#4ade80') : '#64748b',
                  }} />
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Configuração */}
      {configModal.open && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 100,
        }} onClick={() => setConfigModal({ ...configModal, open: false })}>
          <div style={{
            background: '#1e293b',
            borderRadius: '16px',
            border: '1px solid #334155',
            padding: '1.5rem',
            width: '90%',
            maxWidth: '440px',
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>
              ⚙️ {configModal.nickname}
            </h3>
            <p style={{ margin: '0 0 1.25rem', fontSize: '0.85rem', color: '#64748b' }}>
              Configure o melitat (etiqueta de afiliado) para gerar links
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                MELIID (opcional — formato antigo)
              </label>
              <input
                value={configModal.meliid}
                onChange={(e) => setConfigModal({ ...configModal, meliid: (e.target as HTMLInputElement).value })}
                placeholder="Insira o MELIID (deixe vazio para novo formato)..."
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

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                MELITAT (etiqueta de afiliado)
              </label>
              <input
                value={configModal.melitat}
                onChange={(e) => setConfigModal({ ...configModal, melitat: (e.target as HTMLInputElement).value })}
                placeholder="Ex: mtorreao, om895584..."
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

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                Cookies de Sessão (para link curto meli.la)
              </label>
              <textarea
                value={configModal.sessionCookies}
                onChange={(e) => setConfigModal({ ...configModal, sessionCookies: (e.target as HTMLTextAreaElement).value })}
                placeholder="Cole todos os cookies (formato: nome=valor; nome=valor)..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '0.625rem 0.75rem',
                  borderRadius: '8px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  fontSize: '0.85rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'vertical',
                  fontFamily: 'monospace',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.3rem' }}>
                Extraia os cookies do navegador logado no ML (F12 → Application → Cookies) e cole aqui.
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfigModal({ ...configModal, open: false })}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid #475569',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                Cancelar
              </button>
              <button
                onClick={saveConfig}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#6366f1',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                }}
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formulário de conversão */}
      <form onSubmit={handleConvert} style={{
        width: '100%',
        maxWidth: '640px',
        display: 'flex',
        gap: '0.75rem',
        flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
            placeholder="Cole a URL do produto (Shopee ou Mercado Livre)..."
            required
            style={{
              flex: 1,
              padding: '0.875rem 1rem',
              borderRadius: '12px',
              border: '1px solid #334155',
              background: '#1e293b',
              color: '#e2e8f0',
              fontSize: '1rem',
              outline: 'none',
            }}
          />
          <button type="submit" disabled={loading || !url} style={{
            padding: '0.875rem 1.5rem',
            borderRadius: '12px',
            border: 'none',
            background: loading ? '#6366f180' : '#6366f1',
            color: 'white',
            fontSize: '1rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
            whiteSpace: 'nowrap',
          }}>
            {loading ? 'Convertendo...' : 'Converter'}
          </button>
        </div>
        {detectMarketplace(url) === 'mercadolivre' && affiliates.length > 0 && (
          <div style={{ fontSize: '0.8rem', color: '#64748b', paddingLeft: '0.25rem' }}>
            Usando afiliado: <strong style={{ color: '#94a3b8' }}>{affiliates.find(a => a.mlUserId === selectedAffiliate)?.nickname || 'selecionado'}</strong>
          </div>
        )}
      </form>

      {/* Status / Erro */}
      {error && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem 1.25rem',
          background: '#7f1d1d',
          borderRadius: '12px',
          border: '1px solid #991b1b',
          width: '100%',
          maxWidth: '640px',
          color: '#fca5a5',
        }}>
          ❌ {error}
        </div>
      )}

      {/* Resultado */}
      {result && (
        <div style={{
          marginTop: '1.5rem',
          width: '100%',
          maxWidth: '640px',
        }}>
          <div style={{
            background: '#1e293b',
            borderRadius: '12px',
            border: `1px solid ${mpColor}40`,
            overflow: 'hidden',
          }}>
            {/* Header do resultado */}
            <div style={{
              padding: '1rem 1.25rem',
              background: `${mpColor}15`,
              borderBottom: `1px solid ${mpColor}40`,
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
            }}>
              <span style={{ fontSize: '1.5rem' }}>
                {result.success ? '✅' : '❌'}
              </span>
              <div>
                <div style={{ fontWeight: 600 }}>
                  {result.success ? 'Link de afiliado gerado!' : 'Falha na conversão'}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  {MARKETPLACE_NAMES[result.marketplace]} &middot; Método: {result.method}
                  {'mlUserId' in result && (result as Record<string, string>).mlUserId && (
                    <span> &middot; Afiliado: {(result as Record<string, string>).nickname || (result as Record<string, string>).mlUserId}</span>
                  )}
                </div>
              </div>
            </div>

            {/* Conteúdo */}
            <div style={{ padding: '1.25rem' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>
                  URL Original
                </div>
                <div style={{
                  fontSize: '0.9rem',
                  wordBreak: 'break-all',
                  color: '#94a3b8',
                }}>
                  {result.originalUrl}
                </div>
              </div>

              {result.success && result.affiliateUrl && (
                <div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>
                    Link de Afiliado
                  </div>
                  <div style={{
                    background: '#0f172a',
                    padding: '0.75rem 1rem',
                    borderRadius: '8px',
                    border: `1px solid ${mpColor}30`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                  }}>
                    <code style={{
                      flex: 1,
                      fontSize: '0.9rem',
                      wordBreak: 'break-all',
                      color: '#a5b4fc',
                    }}>
                      {result.affiliateUrl}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(result.affiliateUrl!)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '8px',
                        border: '1px solid #334155',
                        background: '#1e293b',
                        color: '#e2e8f0',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Copiar
                    </button>
                  </div>
                  {result.error && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', color: '#f87171' }}>
                      ⚠️ {result.error}
                    </div>
                  )}
                </div>
              )}

              {!result.success && result.error && (
                <div style={{ color: '#f87171', fontSize: '0.9rem' }}>
                  {result.error}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer style={{
        marginTop: 'auto',
        paddingTop: '3rem',
        color: '#475569',
        fontSize: '0.85rem',
        textAlign: 'center',
      }}>
        O Mestre Afiliado — Conversor de links para programas de afiliados
      </footer>
    </div>
  );
}

export default App;
