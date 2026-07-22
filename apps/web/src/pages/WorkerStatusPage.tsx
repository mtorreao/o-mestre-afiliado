/**
 * WorkerStatusPage — Status do worker de espelhamento
 *
 * Exibe healthcheck, uptime, modo, fila, DLQ e últimos erros.
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Badge, Button, Loading, Switch } from '../components/ui/index.ts';
import { Activity, RefreshCw, AlertTriangle } from 'lucide-react';

// ─── Types ──────────────────────────────────────────

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

interface WorkerStatusPageProps {
  onBack: () => void;
}

// ─── Helpers ────────────────────────────────────────

function modeBadge(mode: string): { label: string; variant: 'info' | 'warning' | 'success' | 'neutral' } {
  switch (mode) {
    case 'mirror': return { label: 'Mirror (Redis Stream)', variant: 'info' };
    case 'poll': return { label: 'Poll (Legado)', variant: 'warning' };
    case 'revalidate-daemon': return { label: 'Revalidação', variant: 'success' };
    default: return { label: mode, variant: 'neutral' };
  }
}

function healthStatus(status?: string): { label: string; variant: 'success' | 'error' | 'warning' } {
  if (status === 'healthy') return { label: '✅ Saudável', variant: 'success' };
  if (status === 'unreachable') return { label: '❌ Inacessível', variant: 'error' };
  return { label: '⚠️ Desconhecido', variant: 'warning' };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── Component ──────────────────────────────────────

export function WorkerStatusPage({ onBack }: WorkerStatusPageProps) {
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
    } catch {
      setError('Erro de conexão ao buscar status do worker');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Auto-refresh every 15s
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchStatus, 15_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStatus]);

  function handleRefresh() {
    setLoading(true);
    fetchStatus();
  }

  const health = healthStatus(data?.status);

  return (
    <PageLayout maxWidth="720px">
      <PageHeader
        title="Status do Worker"
        subtitle="Métricas e saúde do worker de espelhamento"
        onBack={onBack}
        actions={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Auto</span>
              <Switch
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
              />
            </div>
            <Button onClick={handleRefresh} loading={loading} icon={<RefreshCw size={14} />} size="sm">
              Atualizar
            </Button>
          </div>
        }
      />

      {/* Loading state */}
      {loading && !data && (
        <Loading text="Carregando status do worker..." />
      )}

      {/* Error state */}
      {error && !data?.success && (
        <Card>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <AlertTriangle size={32} style={{ color: 'var(--color-warning)', marginBottom: '0.75rem' }} />
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginBottom: '0.5rem' }}>{error}</p>
            <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', marginBottom: '1rem' }}>
              O servidor de métricas do worker pode estar offline ou reiniciando.
            </p>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              Tentar novamente
            </Button>
          </div>
        </Card>
      )}

      {/* Main content */}
      {data && data.success && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Health + Info */}
          <Card title="📊 Status Geral">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1.25rem' }}>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>Status</div>
                <Badge variant={health.variant}>{health.label}</Badge>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>Modo</div>
                <Badge variant={modeBadge(data.mode || '').variant}>
                  {modeBadge(data.mode || '').label}
                </Badge>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>Uptime</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>{data.uptime || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>Serviço</div>
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{data.service || '-'}</div>
              </div>
              {data.startTime && (
                <div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.35rem' }}>Iniciado em</div>
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{formatDate(data.startTime)}</div>
                </div>
              )}
            </div>
          </Card>

          {/* Queue + DLQ */}
          <Card title="Filas">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '1rem' }}>
              {/* Queue size */}
              <div
                style={{
                  padding: '1rem',
                  background: 'var(--color-bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                  border: '1px solid var(--color-border-light)',
                }}
              >
                <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-primary)' }}>
                  {data.queueSize !== null && data.queueSize !== undefined ? data.queueSize : '-'}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  Fila (pendentes)
                </div>
              </div>

              {/* DLQ count */}
              <div
                style={{
                  padding: '1rem',
                  background: 'var(--color-bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                  border: '1px solid var(--color-border-light)',
                }}
              >
                <div
                  style={{
                    fontSize: 'var(--text-2xl)',
                    fontWeight: 700,
                    color: data.dlqCount && data.dlqCount > 0 ? 'var(--color-error)' : 'var(--color-success)',
                  }}
                >
                  {data.dlqCount ?? '-'}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                  DLQ (falhas)
                </div>
              </div>

              {/* Total received */}
              {data.counters?.['mirror_messages_received_total'] !== undefined && (
                <div
                  style={{
                    padding: '1rem',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'center',
                    border: '1px solid var(--color-border-light)',
                  }}
                >
                  <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-success)' }}>
                    {String(data.counters['mirror_messages_received_total'])}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                    Recebidas
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* Recent Errors */}
          <Card title="Últimos Erros">
            {!data.errors || data.errors.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                Nenhum erro registrado ✓
              </div>
            ) : (
              <div>
                {data.errors.slice(0, 10).map((err, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '0.6rem 0.75rem',
                      borderBottom: i < data.errors!.length - 1 ? '1px solid var(--color-border-light)' : 'none',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, minWidth: 0 }}>
                        <AlertTriangle size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
                        <span
                          style={{
                            color: 'var(--color-text-primary)',
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
                          <Badge variant="error">{err.count}x</Badge>
                        )}
                        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>
                          {formatDate(err.time)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Counters */}
          {data.counters && Object.keys(data.counters).length > 0 && (
            <Card title="Métricas">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '0.75rem' }}>
                {Object.entries(data.counters).map(([key, value]) => (
                  <div
                    key={key}
                    style={{
                      padding: '0.75rem',
                      background: 'var(--color-bg-secondary)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--color-border-light)',
                    }}
                  >
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.25rem', wordBreak: 'break-word' }}>
                      {key}
                    </div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-primary)' }}>
                      {String(value)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </PageLayout>
  );
}
