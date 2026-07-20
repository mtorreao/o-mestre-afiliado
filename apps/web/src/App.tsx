/**
 * O Mestre Afiliado — Web App
 *
 * Interface React para conversão de links de afiliados
 * (Shopee, Mercado Livre)
 */

import { useState } from 'react';

type Marketplace = 'shopee' | 'mercadolivre' | 'unknown';

interface ConversionResult {
  success: boolean;
  originalUrl: string;
  affiliateUrl: string | null;
  marketplace: Marketplace;
  method: string;
  error?: string;
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

  async function handleConvert(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    setError(null);

    try {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro de conexão');
    } finally {
      setLoading(false);
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
        <h1 style={{
          fontSize: '2.5rem',
          fontWeight: 800,
          background: 'linear-gradient(135deg, #818cf8, #c084fc)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          margin: '0 0 0.5rem',
        }}>
          O Mestre Afiliado
        </h1>
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

      {/* Formulário */}
      <form onSubmit={handleConvert} style={{
        width: '100%',
        maxWidth: '640px',
        display: 'flex',
        gap: '0.75rem',
      }}>
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
                      onClick={() => window.navigator.clipboard.writeText(result.affiliateUrl!)}
                      style={{
                        padding: '0.5rem 0.75rem',
                        borderRadius: '8px',
                        border: '1px solid #334155',
                        background: '#1e293b',
                        color: '#e2e8f0',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.2s',
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
