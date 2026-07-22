/**
 * DashboardPage — Visão geral com métricas e atalhos
 *
 * Dashboard principal que exibe indicadores (grupos, ofertas, WhatsApp, marketplaces),
 * atalhos rápidos para outras páginas e atividade recente de espelhamento.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { Card, Badge, Button, Loading } from '../components/ui/index.ts';
import { fetchApi } from '../lib/api-client.ts';
import {
  Users,
  TrendingUp,
  Smartphone,
  Store,
  Settings,
  ScrollText,
  Activity,
  Package,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────

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
}

interface MirrorLogRow {
  id: number;
  sourceGroupName: string | null;
  targetGroupName: string | null;
  marketplace: string;
  messagePreview: string | null;
  reflectedAt: string;
  status: string;
}

interface MirrorLogResponse {
  success: boolean;
  rows: MirrorLogRow[];
  total: number;
}

interface WppStatusResponse {
  success: boolean;
  connected?: boolean;
  status?: string;
}

// ─── Metric card helper ─────────────────────────────

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  badge?: { label: string; variant: 'success' | 'warning' | 'error' | 'neutral' | 'info' };
  warning?: string;
}

function MetricCard({ icon, label, value, badge, warning }: MetricCardProps) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: warning ? '1px solid var(--color-warning)' : '1px solid var(--color-border)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--spacing-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--spacing-2)',
        transition: 'box-shadow var(--transition-fast)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-primary)',
          }}
        >
          {icon}
        </div>
        {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
      </div>
      <div>
        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
          {value}
        </div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.15rem' }}>
          {label}
        </div>
      </div>
      {warning && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: 'var(--text-xs)', color: 'var(--color-warning)' }}>
          <AlertCircle size={12} />
          <span>{warning}</span>
        </div>
      )}
    </div>
  );
}

// ─── Quick action card helper ───────────────────────

interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}

function QuickActionCard({ icon, label, description, onClick }: QuickActionProps) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--spacing-4)',
        padding: 'var(--spacing-4)',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-xl)',
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
        transition: 'all var(--transition-fast)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-primary)';
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'var(--shadow-card)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--color-border)';
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
      }}
    >
      <div
        style={{
          width: '44px',
          height: '44px',
          borderRadius: 'var(--radius-lg)',
          background: 'var(--color-primary-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-primary)',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: '0.1rem' }}>{description}</div>
      </div>
      <ChevronRight size={16} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
    </button>
  );
}

// ─── Helpers ────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function statusBadgeVariant(status: string): 'success' | 'error' | 'warning' | 'neutral' {
  switch (status) {
    case 'sent': return 'success';
    case 'failed': return 'error';
    case 'blocked': return 'warning';
    default: return 'neutral';
  }
}

function marketplaceIcon(mp: string): string {
  switch (mp) {
    case 'shopee': return '🛒';
    case 'mercadolivre': return '📦';
    case 'amazon': return '📦';
    default: return '❓';
  }
}

// ─── Component ──────────────────────────────────────

interface DashboardPageProps {
  user: { id: number; email: string; name: string };
  token: string;
}

export function DashboardPage({ user, token }: DashboardPageProps) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  const [wppStatus, setWppStatus] = useState<WppStatusResponse | null>(null);
  const [wppLoading, setWppLoading] = useState(true);

  const [mirrorTotal, setMirrorTotal] = useState<number | null>(null);
  const [mirrorTotalLoading, setMirrorTotalLoading] = useState(true);

  const [recentLogs, setRecentLogs] = useState<MirrorLogRow[]>([]);
  const [recentLogsLoading, setRecentLogsLoading] = useState(true);

  // ─── Load profile ───────────────────────────────────
  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    const res = await fetchApi<{ success: boolean; profile: ProfileData }>(
      '/api/affiliate/profile',
      { headers: { Authorization: `Bearer ${token}` } },
      false, // no toast — mostra warning no card
    );
    if (res.success && res.data?.profile) {
      setProfile(res.data.profile);
    }
    setProfileLoading(false);
  }, [token]);

  // ─── Load WhatsApp status ────────────────────────────
  const loadWppStatus = useCallback(async () => {
    setWppLoading(true);
    const res = await fetchApi<WppStatusResponse>(
      '/api/whatsapp/status',
      { headers: { Authorization: `Bearer ${token}` } },
      false,
    );
    if (res.success && res.data) {
      setWppStatus(res.data);
    }
    setWppLoading(false);
  }, [token]);

  // ─── Load mirror logs total ──────────────────────────
  const loadMirrorTotal = useCallback(async () => {
    setMirrorTotalLoading(true);
    const res = await fetchApi<MirrorLogResponse>(
      '/api/affiliate/mirror-logs?page=1&pageSize=1',
      { headers: { Authorization: `Bearer ${token}` } },
      false,
    );
    if (res.success && res.data) {
      setMirrorTotal(res.data.total);
    }
    setMirrorTotalLoading(false);
  }, [token]);

  // ─── Load recent activity ────────────────────────────
  const loadRecentLogs = useCallback(async () => {
    setRecentLogsLoading(true);
    const res = await fetchApi<MirrorLogResponse>(
      '/api/affiliate/mirror-logs?page=1&pageSize=5&status=sent',
      { headers: { Authorization: `Bearer ${token}` } },
      false,
    );
    if (res.success && res.data) {
      setRecentLogs(res.data.rows);
    }
    setRecentLogsLoading(false);
  }, [token]);

  // ─── Load in parallel ────────────────────────────────
  useEffect(() => {
    loadProfile();
    loadWppStatus();
    loadMirrorTotal();
    loadRecentLogs();
  }, [loadProfile, loadWppStatus, loadMirrorTotal, loadRecentLogs]);

  // ─── Derive metrics ────────────────────────────────
  const groupCount = profile?.sourceGroups?.length ?? 0;
  const shopeeConfigured = !!profile?.shopeeConfigured;
  const mlConnected = profile?.mercadoLivre.connected === true;
  const wppConnected = wppStatus?.connected === true;

  // ─── Render ────────────────────────────────────────
  return (
    <PageLayout>
      {/* Section 1: Metric cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: 'var(--spacing-4)',
        }}
      >
        <MetricCard
          icon={<Users size={20} />}
          label="Grupos Monitorados"
          value={profileLoading ? '…' : !profile ? '—' : groupCount}
          warning={!profile && !profileLoading ? 'Não foi possível carregar' : undefined}
        />
        <MetricCard
          icon={<TrendingUp size={20} />}
          label="Ofertas Espelhadas"
          value={mirrorTotalLoading ? '…' : mirrorTotal !== null ? mirrorTotal : '—'}
        />
        <MetricCard
          icon={<Smartphone size={20} />}
          label="WhatsApp"
          value={wppLoading ? '…' : wppConnected ? 'Conectado' : 'Desconectado'}
          badge={
            !wppLoading
              ? wppConnected
                ? { label: 'Conectado', variant: 'success' as const }
                : { label: 'Desconectado', variant: 'warning' as const }
              : undefined
          }
        />
        <MetricCard
          icon={<Store size={20} />}
          label="Marketplaces"
          value={
            profileLoading
              ? '…'
              : !profile
              ? '—'
              : [shopeeConfigured && 'Shopee', mlConnected && 'ML']
                  .filter(Boolean)
                  .join(' + ') || 'Nenhum'
          }
          badge={
            !profileLoading && profile
              ? shopeeConfigured || mlConnected
                ? { label: `${[shopeeConfigured && 'Shopee', mlConnected && 'ML'].filter(Boolean).length} configurado(s)`, variant: 'success' as const }
                : { label: 'Nenhum configurado', variant: 'neutral' as const }
              : undefined
          }
          warning={!profile && !profileLoading ? 'Não foi possível carregar' : undefined}
        />
      </div>

      {/* Section 2: Quick actions */}
      <Card title="Atalhos Rápidos">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-3)' }}>
          <QuickActionCard
            icon={<Settings size={20} />}
            label="Configurar integrações"
            description="WhatsApp, Shopee e Mercado Livre"
            onClick={() => navigate('/settings')}
          />
          <QuickActionCard
            icon={<ScrollText size={20} />}
            label="Ver logs de espelhamento"
            description="Histórico completo de ofertas espelhadas"
            onClick={() => navigate('/mirror-logs')}
          />
          <QuickActionCard
            icon={<Activity size={20} />}
            label="Status do Worker"
            description="Métricas, filas e saúde do worker"
            onClick={() => navigate('/worker-status')}
          />
        </div>
      </Card>

      {/* Section 3: Recent activity */}
      <Card title="Atividade Recente">
        {recentLogsLoading ? (
          <Loading text="Carregando atividade..." size="sm" />
        ) : recentLogs.length === 0 ? (
          <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Nenhuma oferta espelhada recentemente.
          </div>
        ) : (
          <div>
            {recentLogs.map((log) => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.625rem 0',
                  borderBottom: '1px solid var(--color-border-light)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                <Badge variant={statusBadgeVariant(log.status)}>
                  {log.status === 'sent' ? 'Enviada' : log.status}
                </Badge>
                <span style={{ color: 'var(--color-text-secondary)', flexShrink: 0 }}>
                  {marketplaceIcon(log.marketplace)}
                </span>
                <span style={{ color: 'var(--color-text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.sourceGroupName || '—'}
                  <span style={{ color: 'var(--color-text-muted)', margin: '0 0.25rem' }}>→</span>
                  {log.targetGroupName || '—'}
                </span>
                <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  {formatDate(log.reflectedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageLayout>
  );
}
