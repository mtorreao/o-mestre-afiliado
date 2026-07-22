/**
 * WorkerStatus — Tela de status do worker de espelhamento.
 *
 * Exibe healthcheck, uptime, modo, fila, DLQ e últimos erros.
 * Consome GET /api/worker/status.
 */
import { useState, useEffect, useCallback } from 'react';

// ─── Tipos ───────────────────────────────────────────────────────────

interface WorkerStatusResponse {
  success: boolean;
  service?: string;
  status?: string;
  uptime?: string;
  uptimeSeconds?: number;
  startTime?: string;
  mode?: string;
  queueSize?: number | null;
  dlqCount?: number;
  errors?: { time: string; message: string; count: number }[];
  counters?: Record<string, number | string>;
  error?: string;
  workerStatus?: string;
}

interface WorkerStatusProps {
  onBack: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function modeLabel(mode: string): { label: string; color: string } {
  switch (mode) {
    case 'mirror':
      return { label: 'Mirror (Redis Stream)', color: '#6366f1' };
    case 'poll':
      return { label: 'Poll (Legado)', color: '#f59e0b' };
    case 'revalidate-daemon':
      return { label: 'Revalidação', color: '#10b981' };
    default:
      return { label: mode, color: '#94a3b8' };
  }
}

function healthLabel(status?: string): { label: string; color: string } {
  if (status === 'healthy') return { label: '✅ Saudável', color: '#4ade80' };
  if (status === 'unreachable') return { label: '❌ Inacessível', color: '#f87171' };
  return { label: '⚠️ Desconhecido', color: '#fb923c' };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── Componente ──────────────────────────────────────────────────────

export function WorkerStatus({ onBack }: WorkerStatusProps) {
  const [data, setData] = useState<WorkerStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/worker/status');
      const json = await res.json() as WorkerStatusResponse;

      if (json.success) {
        setData(json);
      } else {
        setData(json);
        setError(json.error || 'Falha ao carregar status');
      }
    } catch (err) {
      setError('Erro de conexão ao buscar status do worker');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh a cada 15 segundos
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchStatus, 15_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStatus]);

  function handleRefresh() {
    setLoading(true);
    fetchStatus();
  }

  const health = healthLabel(data?.status);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        color: '#e2e8f0',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: '2rem 1rem',
      }}
    >
      <div style={{ maxWidth: '720px', margin: '0 auto' }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <button
              onClick={onBack}
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
              ← Voltar
            </button>
            <h1 style={{ margin: 0, fontSize: '1.3rem' }}>Status do Worker</h1>
          </div>

          {/* Ações */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <label
              style={{
                fontSize: '0.8rem',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh((e.target as HTMLInputElement).checked)}
                style={{ accentColor: '#6366f1' }}
              />
              Auto
            </label>
            <button
              onClick={handleRefresh}
              disabled={loading}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: loading ? '#6366f180' : '#6366f1',
                color: 'white',
                fontSize: '0.85rem',
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Carregando...' : '🔄 Atualizar'}
            </button>
          </div>
        </div>

        {/* Estado de carregamento */}
        {loading && !data && (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
            Carregando status do worker...
          </div>
        )}

        {/* Erro (quando worker está offline) */}
        {error && !data?.success && (
          <div
            style={{
              background: '#1e293b',
              borderRadius: '12px',
              border: '1px solid #f8717140',
              padding: '1.5rem',
              marginBottom: '1rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⚠️</div>
            <p style={{ color: '#fca5a5', margin: 0, fontSize: '0.95rem' }}>{error}</p>
            <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '0.5rem' }}>
              O servidor de métricas do worker pode estar offline ou reiniciando.
            </p>
            <button
              onClick={handleRefresh}
              style={{
                marginTop: '0.75rem',
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #6366f1',
                background: 'transparent',
                color: '#6366f1',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Tentar novamente
            </button>
          </div>
        )}

        {/* Conteúdo principal */}
        {data && data.success && (
          <>
            {/* Card: Health + Info */}
            <div
              style={{
                background: '#1e293b',
                borderRadius: '12px',
                border: '1px solid #334155',
                padding: '1.25rem',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '1.5rem',
                  alignItems: 'flex-start',
                }}
              >
                {/* Status badge */}
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                    Status
                  </div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.3rem 0.75rem',
                      borderRadius: '999px',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                      background: `${health.color}20`,
                      color: health.color,
                    }}
                  >
                    {health.label}
                  </span>
                </div>

                {/* Modo */}
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                    Modo
                  </div>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.25rem 0.6rem',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      background: `${modeLabel(data.mode || 'unknown').color}20`,
                      color: modeLabel(data.mode || 'unknown').color,
                    }}
                  >
                    {modeLabel(data.mode || 'unknown').label}
                  </span>
                </div>

                {/* Uptime */}
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                    Uptime
                  </div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#e2e8f0' }}>
                    {data.uptime || '-'}
                  </div>
                </div>

                {/* Serviço */}
                <div style={{ flex: '1 1 200px' }}>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                    Serviço
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                    {data.service || '-'}
                  </div>
                </div>

                {/* Início */}
                {data.startTime && (
                  <div style={{ flex: '1 1 200px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem' }}>
                      Iniciado em
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                      {formatDate(data.startTime)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card: Queue + DLQ */}
            <div
              style={{
                background: '#1e293b',
                borderRadius: '12px',
                border: '1px solid #334155',
                padding: '1.25rem',
                marginBottom: '1rem',
              }}
            >
              <h2
                style={{
                  margin: '0 0 1rem',
                  fontSize: '1rem',
                  color: '#e2e8f0',
                  fontWeight: 500,
                }}
              >
                Filas
              </h2>
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                {/* Tamanho da fila */}
                <div
                  style={{
                    flex: '1 1 160px',
                    background: '#0f172a',
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    border: '1px solid #334155',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#6366f1' }}>
                    {data.queueSize !== null && data.queueSize !== undefined
                      ? data.queueSize
                      : '-'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                    Fila (pendentes)
                  </div>
                </div>

                {/* DLQ count */}
                <div
                  style={{
                    flex: '1 1 160px',
                    background: '#0f172a',
                    borderRadius: '8px',
                    padding: '0.75rem 1rem',
                    border: '1px solid #334155',
                    textAlign: 'center',
                  }}
                >
                  <div
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: 700,
                      color: data.dlqCount && data.dlqCount > 0 ? '#f87171' : '#4ade80',
                    }}
                  >
                    {data.dlqCount ?? '-'}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                    DLQ (falhas)
                  </div>
                </div>

                {/* Total processado (de counters) */}
                {data.counters?.['mirror_messages_received_total'] !== undefined && (
                  <div
                    style={{
                      flex: '1 1 160px',
                      background: '#0f172a',
                      borderRadius: '8px',
                      padding: '0.75rem 1rem',
                      border: '1px solid #334155',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#10b981' }}>
                      {String(data.counters['mirror_messages_received_total'])}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                      Recebidas
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Card: Erros Recentes */}
            <div
              style={{
                background: '#1e293b',
                borderRadius: '12px',
                border: '1px solid #334155',
                padding: '1.25rem',
                marginBottom: '1rem',
              }}
            >
              <h2
                style={{
                  margin: '0 0 1rem',
                  fontSize: '1rem',
                  color: '#e2e8f0',
                  fontWeight: 500,
                }}
              >
                Últimos Erros
              </h2>
              {!data.errors || data.errors.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '1rem', color: '#64748b', fontSize: '0.9rem' }}>
                  Nenhum erro registrado ✓
                </div>
              ) : (
                <div>
                  {data.errors.slice(0, 10).map((err, i) => (
                    <div
                      key={i}
                      style={{
                        padding: '0.6rem 0.75rem',
                        borderBottom: i < data.errors!.length - 1 ? '1px solid #334155' : 'none',
                        fontSize: '0.85rem',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, minWidth: 0 }}>
                          <span style={{ color: '#f87171' }}>⚠</span>
                          <span
                            style={{
                              color: '#e2e8f0',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {err.message}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexShrink: 0 }}>
                          {err.count > 1 && (
                            <span
                              style={{
                                background: '#f8717120',
                                color: '#f87171',
                                padding: '0.1rem 0.4rem',
                                borderRadius: '999px',
                                fontSize: '0.7rem',
                                fontWeight: 600,
                              }}
                            >
                              {err.count}x
                            </span>
                          )}
                          <span style={{ color: '#64748b', fontSize: '0.75rem', whiteSpace: 'nowrap' }}>
                            {formatDate(err.time)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Card: Counters */}
            {data.counters && Object.keys(data.counters).length > 0 && (
              <div
                style={{
                  background: '#1e293b',
                  borderRadius: '12px',
                  border: '1px solid #334155',
                  padding: '1.25rem',
                  marginBottom: '1rem',
                }}
              >
                <h2
                  style={{
                    margin: '0 0 1rem',
                    fontSize: '1rem',
                    color: '#e2e8f0',
                    fontWeight: 500,
                  }}
                >
                  Métricas
                </h2>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                    gap: '0.5rem',
                  }}
                >
                  {Object.entries(data.counters).map(([key, value]) => {
                    // Ignora contadores de espera (muitos)
                    if (key.includes('rate_limit_wait')) return null;

                    // Extrai nome amigável
                    const nameMap: Record<string, string> = {
                      mirror_messages_received_total: 'Recebidas',
                      mirror_messages_converted_total: 'Convertidas',
                      mirror_messages_sent_total: 'Enviadas',
                      mirror_messages_blocked_total: 'Bloqueadas',
                      mirror_failures_total: 'Falhas',
                      mirror_deduplicated_total: 'Duplicatas',
                      mirror_rate_limited_total: 'Rate Limit',
                    };

                    const friendlyName = Object.entries(nameMap).find(([k]) =>
                      key.startsWith(k),
                    );

                    return (
                      <div
                        key={key}
                        style={{
                          background: '#0f172a',
                          borderRadius: '6px',
                          border: '1px solid #334155',
                          padding: '0.5rem 0.75rem',
                        }}
                      >
                        <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#e2e8f0' }}>
                          {String(value)}
                        </div>
                        <div
                          style={{
                            fontSize: '0.7rem',
                            color: '#64748b',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={key}
                        >
                          {friendlyName ? friendlyName[1] : key}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
