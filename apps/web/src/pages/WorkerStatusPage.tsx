/**
 * WorkerStatusPage — Status do pipeline de espelhamento (Ingestor + Dispatcher)
 *
 * Exibe visão do pipeline (Queue A → Ingestor → Queue B → Dispatcher),
 * saúde/métricas/latência de cada serviço, e gerenciamento da DLQ.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Badge, Button, Loading, Switch } from '../components/ui/index.ts';
import {
  RefreshCw,
  AlertTriangle,
  ArrowRight,
  RotateCcw,
  Trash2,
  Trash,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  counterLabel,
  stepLabel,
  formatMs,
  formatDate,
  relativeTime,
} from '../lib/worker-status.ts';
import type {
  AggregatedWorkerStatus,
  ServiceStatus,
  DLQListResponse,
  DLQEntry,
  WorkerServiceName,
} from '../lib/worker-status.ts';

// ─── Helpers ────────────────────────────────────────

const SERVICE_META: Record<WorkerServiceName, { label: string; icon: string; desc: string }> = {
  ingestor: { label: 'Ingestor', icon: '📥', desc: 'Queue A → conversão → Queue B' },
  dispatcher: { label: 'Dispatcher', icon: '📤', desc: 'Queue B → envio → Evolution' },
};

function healthBadge(svc: ServiceStatus): { label: string; variant: 'success' | 'error' | 'warning' } {
  if (!svc.reachable) return { label: '❌ Inacessível', variant: 'error' };
  if (svc.status === 'healthy') return { label: '✅ Saudável', variant: 'success' };
  return { label: '⚠️ Desconhecido', variant: 'warning' };
}

// ─── Componentes internos ───────────────────────────

function PipelineView({ data }: { data: AggregatedWorkerStatus }) {
  const ingestor = data.services.find((s) => s.name === 'ingestor');
  const dispatcher = data.services.find((s) => s.name === 'dispatcher');

  const nodes = [
    { key: 'queueA', label: 'Queue A', sub: 'raw', value: data.pipeline.queueA, healthy: true },
    { key: 'ingestor', label: 'Ingestor', sub: 'conversão', value: null, healthy: ingestor?.reachable ?? false },
    { key: 'queueB', label: 'Queue B', sub: 'send', value: data.pipeline.queueB, healthy: true },
    { key: 'dispatcher', label: 'Dispatcher', sub: 'envio', value: null, healthy: dispatcher?.reachable ?? false },
    { key: 'evolution', label: 'Evolution', sub: 'WhatsApp', value: null, healthy: true },
  ];

  return (
    <Card title="🔗 Pipeline de Espelhamento">
      <div
        style={{
          display: 'flex',
          alignItems: 'stretch',
          gap: '0.25rem',
          overflowX: 'auto',
          paddingBottom: '0.25rem',
        }}
      >
        {nodes.map((node, i) => (
          <div key={node.key} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flex: '1 1 0', minWidth: 0 }}>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                alignSelf: 'stretch',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                minHeight: '4.5rem',
                padding: '0.75rem 0.5rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${node.healthy ? 'var(--color-border-light)' : 'var(--color-error)'}`,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {node.label}
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>
                {node.sub}
              </div>
              {node.value !== null && (
                <div
                  style={{
                    marginTop: '0.4rem',
                    fontSize: 'var(--text-lg)',
                    fontWeight: 700,
                    color: node.value > 0 ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  }}
                >
                  {node.value}
                </div>
              )}
              {node.value !== null && (
                <div style={{ fontSize: '0.6rem', color: 'var(--color-text-muted)' }}>pendentes</div>
              )}
              {node.value === null && !node.healthy && (
                <div style={{ marginTop: '0.4rem', fontSize: '0.65rem', color: 'var(--color-error)', fontWeight: 600 }}>
                  offline
                </div>
              )}
            </div>
            {i < nodes.length - 1 && (
              <ArrowRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function MetricTile({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div
      style={{
        padding: '0.6rem 0.75rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-light)',
      }}
    >
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.2rem', wordBreak: 'break-word' }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: color ?? 'var(--color-primary)' }}>
        {value}
      </div>
    </div>
  );
}

function ServiceCard({ svc }: { svc: ServiceStatus }) {
  const meta = SERVICE_META[svc.name];
  const health = healthBadge(svc);
  const counters = svc.counters ?? {};
  const steps = svc.stepDurations ?? {};
  const stepEntries = Object.entries(steps).filter(([, v]) => v.count > 0);

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
          <Badge variant={health.variant}>{health.label}</Badge>
        </span>
      }
    >
      {!svc.reachable ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          <AlertTriangle size={24} style={{ color: 'var(--color-error)', marginBottom: '0.5rem' }} />
          <p style={{ color: 'var(--color-error)', marginBottom: '0.25rem' }}>Serviço inacessível</p>
          <p style={{ fontSize: 'var(--text-xs)' }}>{svc.error || 'O servidor de métricas pode estar offline ou reiniciando.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Info geral */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Uptime</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{svc.uptime || '-'}</div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Fila</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: svc.queueSize ? 'var(--color-primary)' : 'inherit' }}>
                {svc.queueSize ?? '-'}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>DLQ</div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: svc.dlqCount ? 'var(--color-error)' : 'var(--color-success)' }}>
                {svc.dlqCount ?? 0}
              </div>
            </div>
            {svc.startTime && (
              <div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: '0.25rem' }}>Iniciado</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{formatDate(svc.startTime)}</div>
              </div>
            )}
          </div>

          {/* Métricas (counters) */}
          {Object.keys(counters).length > 0 && (
            <div>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Métricas
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.5rem' }}>
                {Object.entries(counters).map(([key, value]) => (
                  <MetricTile key={key} label={counterLabel(key)} value={String(value)} />
                ))}
              </div>
            </div>
          )}

          {/* Latência por etapa */}
          {stepEntries.length > 0 && (
            <div>
              <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                Latência por etapa
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                  <thead>
                    <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
                      <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600 }}>Etapa</th>
                      <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>Média</th>
                      <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>p50</th>
                      <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>p99</th>
                      <th style={{ padding: '0.3rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>Amostras</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepEntries.map(([name, v]) => (
                      <tr key={name} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                        <td style={{ padding: '0.35rem 0.5rem', color: 'var(--color-text-primary)' }}>{stepLabel(name)}</td>
                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatMs(v.avg)}</td>
                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--color-text-secondary)' }}>{formatMs(v.p50)}</td>
                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: v.p99 > 5000 ? 'var(--color-warning)' : 'var(--color-text-secondary)' }}>{formatMs(v.p99)}</td>
                        <td style={{ padding: '0.35rem 0.5rem', textAlign: 'right', color: 'var(--color-text-muted)' }}>{v.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Últimos erros */}
          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
              Últimos erros
            </div>
            {!svc.errors || svc.errors.length === 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>Nenhum erro registrado ✓</div>
            ) : (
              <div>
                {svc.errors.slice(0, 5).map((err, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.4rem 0',
                      borderBottom: i < Math.min(svc.errors!.length, 5) - 1 ? '1px solid var(--color-border-light)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1, minWidth: 0 }}>
                      <AlertTriangle size={13} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
                      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {err.message}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
                      {err.count > 1 && <Badge variant="error">{err.count}x</Badge>}
                      <span style={{ color: 'var(--color-text-muted)', fontSize: '0.65rem', whiteSpace: 'nowrap' }}>{relativeTime(err.time)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function DLQSection() {
  const [data, setData] = useState<DLQListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/worker/dlq?limit=20');
      const json = (await res.json()) as DLQListResponse;
      setData(json);
    } catch {
      // ignora
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRequeue(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/worker/dlq/requeue?id=${encodeURIComponent(id)}`, { method: 'POST' });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemove(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/worker/dlq/remove?id=${encodeURIComponent(id)}`, { method: 'POST' });
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function handlePurge() {
    setPurging(true);
    try {
      await fetch('/api/worker/dlq/purge', { method: 'POST' });
      await load();
    } finally {
      setPurging(false);
    }
  }

  const items: DLQEntry[] = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🗑️ Dead Letter Queue</span>
          {total > 0 && <Badge variant="error">{total}</Badge>}
        </span>
      }
      action={
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {total > 0 && (
            <Button variant="outline" size="sm" onClick={handlePurge} loading={purging} icon={<Trash size={13} />}>
              Limpar antigos
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)} icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}>
            {expanded ? 'Recolher' : 'Ver itens'}
          </Button>
        </div>
      }
    >
      {total === 0 ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          DLQ vazia ✓ — nenhuma falha permanente
        </div>
      ) : !expanded ? (
        <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          {total} {total === 1 ? 'item com' : 'itens com'} falha permanente. Clique em "Ver itens" para gerenciar.
        </div>
      ) : loading && !data ? (
        <Loading text="Carregando DLQ..." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {items.map((item) => (
            <div
              key={item.id}
              style={{
                padding: '0.75rem',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-light)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <Badge variant="error">{item.failureReason}</Badge>
                    {item.marketplace && <Badge variant="neutral">{item.marketplace}</Badge>}
                    {item.reprocessed && <Badge variant="success">reprocessado</Badge>}
                  </div>
                </div>
                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                  {relativeTime(item.failedAt)}
                </span>
              </div>

              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.4rem', wordBreak: 'break-word' }}>
                {item.lastError}
              </div>

              {item.originalUrl && (
                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem', wordBreak: 'break-all' }}>
                  🔗 {item.originalUrl}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                  {item.attempts} tentativa(s)
                </span>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRequeue(item.id)}
                    loading={busyId === item.id}
                    icon={<RotateCcw size={13} />}
                  >
                    Re-enfileirar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemove(item.id)}
                    disabled={busyId === item.id}
                    icon={<Trash2 size={13} />}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Página ─────────────────────────────────────────

export function WorkerStatusPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AggregatedWorkerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/worker/status');
      const json = (await res.json()) as AggregatedWorkerStatus;
      setData(json);
    } catch {
      setError('Erro de conexão ao buscar status do worker');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchStatus, 15_000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchStatus]);

  function handleRefresh() {
    setLoading(true);
    fetchStatus();
  }

  const anyReachable = data?.services.some((s) => s.reachable) ?? false;

  return (
    <PageLayout maxWidth="900px">
      <PageHeader
        title="Status do Worker"
        subtitle="Pipeline de espelhamento — Ingestor + Dispatcher"
        onBack={() => navigate('/')}
        actions={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Auto</span>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            </div>
            <Button onClick={handleRefresh} loading={loading} icon={<RefreshCw size={14} />} size="sm">
              Atualizar
            </Button>
          </div>
        }
      />

      {loading && !data && <Loading text="Carregando status do worker..." />}

      {error && !data && (
        <Card>
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <AlertTriangle size={32} style={{ color: 'var(--color-warning)', marginBottom: '0.75rem' }} />
            <p style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginBottom: '0.5rem' }}>{error}</p>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              Tentar novamente
            </Button>
          </div>
        </Card>
      )}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <PipelineView data={data} />

          {!anyReachable && (
            <Card>
              <div style={{ textAlign: 'center', padding: '0.75rem', color: 'var(--color-warning)', fontSize: 'var(--text-sm)' }}>
                <AlertTriangle size={18} style={{ verticalAlign: 'middle', marginRight: '0.4rem' }} />
                Nenhum serviço de métricas está acessível. Os processadores podem estar offline ou reiniciando.
              </div>
            </Card>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>
            {data.services.map((svc) => (
              <ServiceCard key={svc.name} svc={svc} />
            ))}
          </div>

          <DLQSection />
        </div>
      )}
    </PageLayout>
  );
}
