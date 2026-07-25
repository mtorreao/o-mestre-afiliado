/**
 * WorkerStatusPage — Dashboard de saúde e performance dos workers (Ingestor + Dispatcher)
 *
 * Mostra 5 seções em uma única página:
 *   1. Pipeline       — Queue A → Ingestor → Queue B → Dispatcher → Evolution
 *   2. Resumo saúde   — uptime, modo, último erro, DLQ, queue size por worker
 *   3. Ingestor       — métricas e latências detalhadas
 *   4. Dispatcher     — métricas e latências detalhadas (com breakdown por marketplace)
 *   5. DLQ            — destaque, com expansão inline para gestão
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
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
  X,
  ExternalLink,
} from 'lucide-react';
import {
  counterLabel,
  stepLabel,
  formatMs,
  formatDate,
  relativeTime,
  labelValueLabel,
  marketplaceLabel,
  normalizeDLQEvent,
  getFailureMeta,
} from '../lib/worker-status.ts';
import { sumByName, aggregateByLabel, rankedByLabel } from '../lib/worker-counters.ts';
import type {
  AggregatedWorkerStatus,
  ServiceStatus,
  DLQListResponse,
  DLQEntry,
  DLQEvent,
  WorkerServiceName,
} from '../lib/worker-status.ts';

// ─── Meta por serviço ─────────────────────────────────

const SERVICE_META: Record<WorkerServiceName, { label: string; icon: string; desc: string; accent: string }> = {
  ingestor: {
    label: 'Ingestor',
    icon: '📥',
    desc: 'Queue A → conversão → Queue B',
    accent: 'var(--color-info)',
  },
  dispatcher: {
    label: 'Dispatcher',
    icon: '📤',
    desc: 'Queue B → envio → Evolution',
    accent: 'var(--color-primary)',
  },
};

function healthBadge(svc: ServiceStatus): { label: string; variant: 'success' | 'error' | 'warning' } {
  if (!svc.reachable) return { label: 'Inacessível', variant: 'error' };
  if (svc.status === 'healthy') return { label: 'Saudável', variant: 'success' };
  return { label: 'Desconhecido', variant: 'warning' };
}

function isEmpty(...values: number[]): boolean {
  return values.every((v) => v === 0);
}

// ─── Pipeline view ────────────────────────────────────

function PipelineView({ data }: { data: AggregatedWorkerStatus }) {
  const ingestor = data.services.find((s) => s.name === 'ingestor');
  const dispatcher = data.services.find((s) => s.name === 'dispatcher');

  const nodes = [
    { key: 'queueA', label: 'Queue A', sub: 'raw', value: data.pipeline.queueA, healthy: true },
    { key: 'ingestor', label: 'Ingestor', sub: 'conversão', value: null as number | null, healthy: ingestor?.reachable ?? false },
    { key: 'queueB', label: 'Queue B', sub: 'send', value: data.pipeline.queueB, healthy: true },
    { key: 'dispatcher', label: 'Dispatcher', sub: 'envio', value: null as number | null, healthy: dispatcher?.reachable ?? false },
    { key: 'evolution', label: 'Evolution', sub: 'WhatsApp', value: null, healthy: true },
  ];

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <span>🔗</span>
          <span>Pipeline de Espelhamento</span>
        </span>
      }
      subtitle="Mensagens em trânsito (XLEN dos streams Redis)"
    >
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

// ─── Resumo de saúde (2 colunas) ──────────────────────

function HealthSummary({ data }: { data: AggregatedWorkerStatus }) {
  return (
    <Card title="📊 Resumo de Saúde" subtitle="Estado operacional de cada worker">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.75rem' }}>
        {data.services.map((svc) => (
          <ServiceSummary key={svc.name} svc={svc} />
        ))}
      </div>
    </Card>
  );
}

function ServiceSummary({ svc }: { svc: ServiceStatus }) {
  const meta = SERVICE_META[svc.name];
  const health = healthBadge(svc);
  const distinctErrors = svc.errors?.length ?? 0;
  const lastErrorTime = svc.errors?.[0]?.time;

  return (
    <div
      style={{
        padding: '0.75rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        borderLeft: `3px solid ${meta.accent}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: 'var(--text-sm)' }}>
          <span>{meta.icon}</span>
          <span>{meta.label}</span>
        </span>
        <Badge variant={health.variant}>{health.label}</Badge>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem', fontSize: 'var(--text-xs)' }}>
        <Field label="Uptime" value={svc.uptime || '—'} />
        <Field label="Modo" value={svc.mode || '—'} />
        <Field
          label="Queue size"
          value={svc.queueSize != null ? String(svc.queueSize) : '—'}
          accent={svc.queueSize && svc.queueSize > 50 ? 'var(--color-warning)' : undefined}
        />
        <Field
          label="DLQ"
          value={String(svc.dlqCount ?? 0)}
          accent={svc.dlqCount && svc.dlqCount > 0 ? 'var(--color-error)' : 'var(--color-success)'}
        />
        <Field
          label="Erros distintos"
          value={String(distinctErrors)}
          accent={distinctErrors > 0 ? 'var(--color-warning)' : 'var(--color-text-muted)'}
        />
        <Field
          label="Último erro"
          value={lastErrorTime ? relativeTime(lastErrorTime) : '—'}
          accent={lastErrorTime ? 'var(--color-text-muted)' : 'var(--color-text-muted)'}
        />
      </div>

      {svc.startTime && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
          Iniciado em {formatDate(svc.startTime)}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <div style={{ color: 'var(--color-text-muted)', fontSize: '0.65rem', marginBottom: '0.1rem' }}>{label}</div>
      <div style={{ fontWeight: 600, color: accent ?? 'var(--color-text-primary)' }}>{value}</div>
    </div>
  );
}

// ─── Card detalhado por serviço ───────────────────────

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
      subtitle={meta.desc}
      style={{ borderLeft: `3px solid ${meta.accent}` }}
    >
      {!svc.reachable ? (
        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          <AlertTriangle size={24} style={{ color: 'var(--color-error)', marginBottom: '0.5rem' }} />
          <p style={{ color: 'var(--color-error)', marginBottom: '0.25rem' }}>Serviço inacessível</p>
          <p style={{ fontSize: 'var(--text-xs)' }}>{svc.error || 'O servidor de métricas pode estar offline ou reiniciando.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Métricas por seção, agregadas por label */}
          <ServiceMetrics serviceName={svc.name} counters={counters} />

          {/* Latência por etapa */}
          {stepEntries.length > 0 && (
            <div>
              <SectionTitle>Latência por etapa</SectionTitle>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
                  <thead>
                    <tr style={{ color: 'var(--color-text-muted)', textAlign: 'left' }}>
                      <th style={th()}>Etapa</th>
                      <th style={th('right')}>Média</th>
                      <th style={th('right')}>p50</th>
                      <th style={th('right')}>p99</th>
                      <th style={th('right')}>Amostras</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stepEntries.map(([name, v]) => (
                      <tr key={name} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                        <td style={td()}>{stepLabel(name)}</td>
                        <td style={td('right')}>{formatMs(v.avg)}</td>
                        <td style={td('right')}>{formatMs(v.p50)}</td>
                        <td style={td('right', v.p99 > 5000 ? 'var(--color-warning)' : undefined)}>{formatMs(v.p99)}</td>
                        <td style={td('right', 'var(--color-text-muted)')}>{v.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Últimos erros */}
          <div>
            <SectionTitle>Últimos erros</SectionTitle>
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

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 'var(--text-xs)',
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        marginBottom: '0.5rem',
        textTransform: 'uppercase',
        letterSpacing: '0.03em',
      }}
    >
      {children}
    </div>
  );
}

function th(align: 'left' | 'right' = 'left'): React.CSSProperties {
  return { padding: '0.3rem 0.5rem', fontWeight: 600, textAlign: align };
}

function td(align: 'left' | 'right' = 'left', color?: string): React.CSSProperties {
  return {
    padding: '0.35rem 0.5rem',
    textAlign: align,
    color: color ?? 'var(--color-text-secondary)',
  };
}

// ─── Métricas por serviço (agregadas por label) ───────

function ServiceMetrics({ serviceName, counters }: { serviceName: WorkerServiceName; counters: Record<string, number | string> }) {
  if (serviceName === 'ingestor') {
    return <IngestorMetrics counters={counters} />;
  }
  return <DispatcherMetrics counters={counters} />;
}

function IngestorMetrics({ counters }: { counters: Record<string, number | string> }) {
  const received = sumByName(counters, 'pipeline_messages_received_total');
  const blockedByReason = rankedByLabel(counters, 'pipeline_messages_blocked_total', 'reason');
  const blockedTotal = blockedByReason.reduce((acc, x) => acc + x.value, 0);
  const published = sumByName(counters, 'pipeline_send_events_published_total');
  const imageByResult = aggregateByLabel(counters, 'pipeline_image_fetch_total', 'result');
  const imageTotal = (imageByResult.found ?? 0) + (imageByResult.not_found ?? 0);
  const missingFallback = sumByName(counters, 'pipeline_image_missing_fallback_total');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem' }}>
      <MetricTile label="Mensagens recebidas" value={received} />
      <div>
        <MetricTile
          label="Bloqueadas"
          value={blockedTotal}
          accent={blockedTotal > 0 ? 'var(--color-warning)' : undefined}
        />
        {blockedByReason.length > 0 && (
          <Breakdown items={blockedByReason} labelName="reason" />
        )}
      </div>
      <MetricTile label="Eventos publicados" value={published} accent="var(--color-primary)" />
      <div>
        <MetricTile label="Busca de imagem" value={imageTotal} />
        {imageTotal > 0 && (
          <Breakdown
            items={[
              { label: 'found', value: imageByResult.found ?? 0 },
              { label: 'not_found', value: imageByResult.not_found ?? 0 },
            ]}
            labelName="result"
          />
        )}
      </div>
      {missingFallback > 0 && (
        <MetricTile label="Sem imagem (fallback)" value={missingFallback} accent="var(--color-text-muted)" />
      )}
    </div>
  );
}

function DispatcherMetrics({ counters }: { counters: Record<string, number | string> }) {
  const received = sumByName(counters, 'sender_events_received_total');
  const sentByMarketplace = aggregateByLabel(counters, 'sender_messages_sent_total', 'marketplace');
  const sentTotal = Object.values(sentByMarketplace).reduce((a, b) => a + b, 0);
  const sentWithImage = sumByName(counters, 'sender_messages_sent_with_image_total');
  const skippedByReason = rankedByLabel(counters, 'sender_messages_skipped_total', 'reason');
  const skippedTotal = skippedByReason.reduce((a, b) => a + b.value, 0);
  const failuresByType = rankedByLabel(counters, 'sender_failures_total', 'type');
  const failuresTotal = failuresByType.reduce((a, b) => a + b.value, 0);

  if (isEmpty(received, sentTotal, skippedTotal, failuresTotal) && sentWithImage === 0) {
    return (
      <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center', padding: '0.75rem' }}>
        Nenhuma atividade registrada ainda — aguarde o envio da primeira mensagem.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.5rem' }}>
      <MetricTile label="SendEvents recebidos" value={received} />
      <div>
        <MetricTile label="Enviadas" value={sentTotal} accent="var(--color-success)" />
        {Object.keys(sentByMarketplace).length > 0 && (
          <Breakdown
            items={Object.entries(sentByMarketplace).map(([label, value]) => ({ label, value }))}
            labelName="marketplace"
            customLabel={marketplaceLabel}
          />
        )}
      </div>
      {sentWithImage > 0 && <MetricTile label="Com imagem" value={sentWithImage} />}
      <div>
        <MetricTile
          label="Descartadas"
          value={skippedTotal}
          accent={skippedTotal > 0 ? 'var(--color-warning)' : undefined}
        />
        {skippedByReason.length > 0 && <Breakdown items={skippedByReason} labelName="reason" />}
      </div>
      <div>
        <MetricTile
          label="Falhas"
          value={failuresTotal}
          accent={failuresTotal > 0 ? 'var(--color-error)' : 'var(--color-success)'}
        />
        {failuresByType.length > 0 && <Breakdown items={failuresByType} labelName="type" />}
      </div>
    </div>
  );
}

function MetricTile({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div
      style={{
        padding: '0.6rem 0.75rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-light)',
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          marginBottom: '0.2rem',
          wordBreak: 'break-word',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: accent ?? 'var(--color-primary)' }}>
        {value}
      </div>
    </div>
  );
}

/**
 * Sub-lista compacta de "X: 5" para mostrar breakdown por label.
 * Usa o label-value-label PT-BR (ex: "Falha na conversão" em vez de "conversion_failed").
 */
function Breakdown({
  items,
  labelName,
  customLabel,
}: {
  items: Array<{ label: string; value: number }>;
  labelName: string;
  customLabel?: (v: string) => string;
}) {
  return (
    <ul
      style={{
        listStyle: 'none',
        margin: '0.35rem 0 0',
        padding: 0,
        fontSize: '0.65rem',
        color: 'var(--color-text-muted)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.1rem',
      }}
    >
      {items.map((it) => (
        <li
          key={it.label}
          style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}
          title={`${counterLabel(labelName)} = ${it.label}`}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {customLabel ? customLabel(it.label) : labelValueLabel(labelName, it.label)}
          </span>
          <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{it.value}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── DLQ item (com expansão inline por item) ──────────

function DLQItem({
  item,
  busy,
  onRequeue,
  onRemove,
}: {
  item: DLQEntry;
  busy: boolean;
  onRequeue: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const navigate = useNavigate();
  const meta = getFailureMeta(item.failureReason);
  const event = normalizeDLQEvent(item.event);
  const hasDetails = event !== undefined;
  // mirrorId está em ambos os tipos de evento (raw é opcional, send é obrigatório)
  const mirrorId = event?.mirrorId;

  return (
    <div
      style={{
        padding: '0.75rem',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-light)',
      }}
    >
      {/* Linha 1: badges + timestamp relativo (com tooltip absoluto) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
            <Badge variant="error">{item.failureReason}</Badge>
            <Badge variant={meta.queue === 'A' ? 'info' : 'warning'}>Queue {meta.queue}</Badge>
            {item.marketplace && <Badge variant="neutral">{item.marketplace}</Badge>}
            {item.reprocessed && <Badge variant="success">reprocessado</Badge>}
            {mirrorId != null && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/mirror-form/${mirrorId}`);
                }}
                title={`Abrir espelhamento #${mirrorId} no MirrorFormPage`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  padding: '0.15rem 0.5rem',
                  fontSize: '0.65rem',
                  fontWeight: 500,
                  borderRadius: 'var(--radius-full)',
                  border: '1px solid var(--color-border-light)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  lineHeight: 1.5,
                }}
              >
                <span>mirror #{mirrorId}</span>
                <ExternalLink size={10} />
              </button>
            )}
          </div>
        </div>
        <span
          title={formatDate(item.failedAt)}
          style={{
            fontSize: '0.65rem',
            color: 'var(--color-text-muted)',
            whiteSpace: 'nowrap',
            cursor: 'help',
            borderBottom: '1px dotted var(--color-border-light)',
          }}
        >
          {relativeTime(item.failedAt)}
        </span>
      </div>

      {/* Linha 2: etapa legível (humanizada) + última mensagem de erro */}
      <div style={{ fontSize: 'var(--text-xs)', marginBottom: '0.4rem' }}>
        <span style={{ color: 'var(--color-text-muted)' }}>Etapa:</span>{' '}
        <span style={{ color: 'var(--color-text-primary)', fontWeight: 600 }}>{meta.stage}</span>
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginBottom: '0.4rem', wordBreak: 'break-word' }}>
        {item.lastError}
      </div>

      {item.originalUrl && (
        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', marginBottom: '0.4rem', wordBreak: 'break-all' }}>
          🔗 {item.originalUrl}
        </div>
      )}

      {/* Linha 3: ações + toggle de detalhes */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
          {item.attempts} tentativa(s)
        </span>
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {hasDetails && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              icon={expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              aria-expanded={expanded}
            >
              {expanded ? 'Ocultar body' : 'Ver body'}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRequeue(item.id)}
            loading={busy}
            icon={<RotateCcw size={13} />}
          >
            Re-enfileirar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRemove(item.id)}
            disabled={busy}
            icon={<Trash2 size={13} />}
          >
            Remover
          </Button>
        </div>
      </div>

      {/* Detalhes expansíveis: corpo do evento original */}
      {expanded && event && <DLQItemDetails event={event} />}
    </div>
  );
}

function DLQItemDetails({ event }: { event: DLQEvent }) {
  if (event.kind === 'raw') {
    return (
      <div
        style={{
          marginTop: '0.5rem',
          paddingTop: '0.5rem',
          borderTop: '1px solid var(--color-border-light)',
          fontSize: 'var(--text-xs)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
        }}
      >
        <DetailRow label="messageId" value={event.messageId} mono />
        {event.instanceName && <DetailRow label="instanceName" value={event.instanceName} mono />}
        {event.sourceGroupJid && <DetailRow label="sourceGroupJid" value={event.sourceGroupJid} mono />}
        {event.sourceGroupName && <DetailRow label="sourceGroupName" value={event.sourceGroupName} />}
        {event.affiliateId != null && <DetailRow label="affiliateId" value={String(event.affiliateId)} />}
        {event.mirrorId != null && <DetailRow label="mirrorId" value={String(event.mirrorId)} />}
        {event.timestamp != null && (
          <DetailRow
            label="timestamp"
            value={`${event.timestamp} (${formatDate(new Date(event.timestamp * 1000).toISOString())})`}
            mono
          />
        )}
        {event.text && (
          <div>
            <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>text (mensagem original)</div>
            <pre
              style={{
                margin: 0,
                padding: '0.5rem',
                background: 'var(--color-bg)',
                border: '1px solid var(--color-border-light)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.7rem',
                fontFamily: 'var(--font-mono, monospace)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                maxHeight: 200,
                overflow: 'auto',
              }}
            >
              {event.text}
            </pre>
          </div>
        )}
      </div>
    );
  }

  // event.kind === 'send'
  return (
    <div
      style={{
        marginTop: '0.5rem',
        paddingTop: '0.5rem',
        borderTop: '1px solid var(--color-border-light)',
        fontSize: 'var(--text-xs)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.35rem',
      }}
    >
      <DetailRow label="id" value={event.id} mono />
      <DetailRow label="sourceMessageId" value={event.sourceMessageId} mono />
      {event.sourceGroupJid && <DetailRow label="sourceGroupJid" value={event.sourceGroupJid} mono />}
      <DetailRow label="mirrorId" value={String(event.mirrorId)} />
      <DetailRow label="marketplace" value={event.marketplace} />
      <DetailRow label="originalUrl" value={event.originalUrl} mono />
      {event.convertedUrl && event.convertedUrl !== event.originalUrl && (
        <DetailRow label="convertedUrl" value={event.convertedUrl} mono />
      )}
      {event.imageUrl && <DetailRow label="imageUrl" value={event.imageUrl} mono />}
      {event.text && (
        <div>
          <div style={{ color: 'var(--color-text-muted)', marginBottom: '0.2rem' }}>text (template resolvido)</div>
          <pre
            style={{
              margin: 0,
              padding: '0.5rem',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border-light)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.7rem',
              fontFamily: 'var(--font-mono, monospace)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: 200,
              overflow: 'auto',
            }}
          >
            {event.text}
          </pre>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
      <span style={{ color: 'var(--color-text-muted)', minWidth: 130, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: 'var(--color-text-primary)',
          wordBreak: 'break-all',
          fontFamily: mono ? 'var(--font-mono, monospace)' : undefined,
          fontSize: mono ? '0.7rem' : 'var(--text-xs)',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── DLQ section (top-level) ──────────────────────────

type QueueFilter = 'all' | 'A' | 'B';

function DLQSection() {
  const [data, setData] = useState<DLQListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purging, setPurging] = useState(false);
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [reasonFilter, setReasonFilter] = useState<string | null>(null);

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

  // Contagem por failureReason (sobre a lista carregada, não sobre o total geral).
  // Usada para popular os chips de filtro com valores reais do que o usuário está vendo.
  const reasonCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.failureReason, (counts.get(item.failureReason) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }, [items]);

  // Filtro client-side: queueFilter usa o tipo do evento cru;
  // reasonFilter é comparação exata de string.
  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (reasonFilter && item.failureReason !== reasonFilter) return false;
      if (queueFilter !== 'all') {
        const meta = getFailureMeta(item.failureReason);
        if (meta.queue !== queueFilter) return false;
      }
      return true;
    });
  }, [items, queueFilter, reasonFilter]);

  const hasActiveFilter = queueFilter !== 'all' || reasonFilter !== null;
  function clearFilters() {
    setQueueFilter('all');
    setReasonFilter(null);
  }

  return (
    <Card
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span>🗑️</span>
          <span>Dead Letter Queue</span>
          {total > 0 && <Badge variant="error">{total}</Badge>}
        </span>
      }
      subtitle="Mensagens que falharam permanentemente após todas as tentativas"
      action={
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {total > 0 && (
            <Button variant="outline" size="sm" onClick={handlePurge} loading={purging} icon={<Trash size={13} />}>
              Limpar antigos
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((v) => !v)}
            icon={expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          >
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
          <DLQFilterBar
            queueFilter={queueFilter}
            onQueueFilterChange={setQueueFilter}
            reasonCounts={reasonCounts}
            reasonFilter={reasonFilter}
            onReasonFilterChange={setReasonFilter}
            onClearFilters={clearFilters}
            hasActiveFilter={hasActiveFilter}
            totalShown={filteredItems.length}
            totalLoaded={items.length}
          />

          {filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '0.75rem', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
              Nenhum item corresponde aos filtros.{' '}
              <button
                onClick={clearFilters}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-primary)',
                  cursor: 'pointer',
                  padding: 0,
                  font: 'inherit',
                  textDecoration: 'underline',
                }}
              >
                Limpar filtros
              </button>
            </div>
          ) : (
            filteredItems.map((item) => (
              <DLQItem
                key={item.id}
                item={item}
                busy={busyId === item.id}
                onRequeue={handleRequeue}
                onRemove={handleRemove}
              />
            ))
          )}
        </div>
      )}
    </Card>
  );
}

// ─── DLQ filter bar ───────────────────────────────────

function DLQFilterBar({
  queueFilter,
  onQueueFilterChange,
  reasonCounts,
  reasonFilter,
  onReasonFilterChange,
  onClearFilters,
  hasActiveFilter,
  totalShown,
  totalLoaded,
}: {
  queueFilter: QueueFilter;
  onQueueFilterChange: (q: QueueFilter) => void;
  reasonCounts: Array<{ reason: string; count: number }>;
  reasonFilter: string | null;
  onReasonFilterChange: (r: string | null) => void;
  onClearFilters: () => void;
  hasActiveFilter: boolean;
  totalShown: number;
  totalLoaded: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.5rem 0.6rem',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>Fila:</span>
        <SegmentedButton active={queueFilter === 'all'} onClick={() => onQueueFilterChange('all')} label="Todas" />
        <SegmentedButton active={queueFilter === 'A'} onClick={() => onQueueFilterChange('A')} label="Queue A" />
        <SegmentedButton active={queueFilter === 'B'} onClick={() => onQueueFilterChange('B')} label="Queue B" />

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-muted)' }}>
          Mostrando {totalShown} de {totalLoaded}
        </span>

        {hasActiveFilter && (
          <Button variant="ghost" size="sm" onClick={onClearFilters} icon={<X size={12} />}>
            Limpar
          </Button>
        )}
      </div>

      {reasonCounts.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 600 }}>Motivo:</span>
          {reasonCounts.map(({ reason, count }) => {
            const active = reasonFilter === reason;
            const meta = getFailureMeta(reason);
            return (
              <button
                key={reason}
                onClick={() => onReasonFilterChange(active ? null : reason)}
                aria-pressed={active}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem',
                  padding: '0.15rem 0.5rem',
                  fontSize: '0.7rem',
                  fontWeight: active ? 600 : 500,
                  borderRadius: 'var(--radius-full)',
                  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border-light)'}`,
                  background: active ? 'var(--color-primary-subtle)' : 'var(--color-bg-secondary)',
                  color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  lineHeight: 1.5,
                  fontFamily: 'inherit',
                }}
                title={meta.stage}
              >
                <span>{reason}</span>
                <span
                  style={{
                    fontSize: '0.6rem',
                    padding: '0 0.3rem',
                    borderRadius: 'var(--radius-full)',
                    background: active ? 'var(--color-primary)' : 'var(--color-border-light)',
                    color: active ? 'var(--color-primary-contrast, white)' : 'var(--color-text-muted)',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SegmentedButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '0.2rem 0.6rem',
        fontSize: 'var(--text-xs)',
        fontWeight: active ? 600 : 500,
        borderRadius: 'var(--radius-full)',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border-light)'}`,
        background: active ? 'var(--color-primary-subtle)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {label}
    </button>
  );
}

// ─── Página ──────────────────────────────────────────

const STALE_AFTER_MS = 30_000;

function useTickEvery(intervalMs: number): number {
  // Hook re-render a cada `intervalMs` para refrescar indicadores relativos
  // (ex: "Atualizado há Xs") sem precisar de fetch. Retorna timestamp atual.
  const [tick, setTick] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}

export function WorkerStatusPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<AggregatedWorkerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const tick = useTickEvery(10_000);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch('/api/worker/status');
      const json = (await res.json()) as AggregatedWorkerStatus;
      setData(json);
      setLastUpdate(new Date());
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
  const isStale = lastUpdate ? tick - lastUpdate.getTime() > STALE_AFTER_MS : false;

  return (
    <PageLayout maxWidth="900px">
      <PageHeader
        title="Status do Worker"
        subtitle="Pipeline de espelhamento — Ingestor + Dispatcher"
        onBack={() => navigate('/')}
        actions={
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            {lastUpdate && (
              <span
                title={
                  isStale
                    ? 'Dados com mais de 30s — auto-refresh pode estar parado'
                    : 'Dados ao vivo'
                }
                style={{
                  fontSize: '0.65rem',
                  color: isStale ? 'var(--color-warning)' : 'var(--color-text-muted)',
                  fontWeight: isStale ? 600 : 400,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: isStale ? 'var(--color-warning)' : 'var(--color-success)',
                  }}
                />
                Atualizado {relativeTime(lastUpdate.toISOString())}
              </span>
            )}
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

      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <div
                  style={{
                    height: 12,
                    width: '40%',
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 'var(--radius-sm)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
                <div
                  style={{
                    height: 32,
                    background: 'var(--color-bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    animation: 'pulse 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

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

          <HealthSummary data={data} />

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
