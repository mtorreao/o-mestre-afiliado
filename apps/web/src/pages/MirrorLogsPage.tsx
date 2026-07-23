/**
 * MirrorLogsPage — Logs de mensagens espelhadas
 *
 * Tabela com filtros por status, marketplace, período e busca textual.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Button, Select, Badge, Loading, LoadingSkeleton, FilterBar, MobileFilterBar } from '../components/ui/index.ts';
import { fetchApi } from '../lib/api-client.ts';
import { Filter, RotateCw, Search, X, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';

// ─── Types ──────────────────────────────────────────

interface MirrorLogRow {
  id: number;
  affiliateId: number;
  sourceGroupJid: string;
  sourceGroupName: string | null;
  targetGroupJid: string;
  targetGroupName: string | null;
  originalLink: string;
  convertedLink: string;
  marketplace: string;
  messagePreview: string | null;
  reflectedAt: string;
  status: string;
  failureReason: string | null;
}

interface MirrorLogResponse {
  success: boolean;
  rows: MirrorLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface MirrorLogsPageProps {
  token: string;
}

// ─── Helpers ────────────────────────────────────────

function statusBadge(status: string): { label: string; variant: 'success' | 'error' | 'warning' | 'neutral' } {
  switch (status) {
    case 'sent': return { label: 'Enviada', variant: 'success' };
    case 'failed': return { label: 'Falha', variant: 'error' };
    case 'blocked': return { label: 'Bloqueada', variant: 'warning' };
    default: return { label: status, variant: 'neutral' };
  }
}

function marketplaceLabel(mp: string): string {
  switch (mp) {
    case 'shopee': return '🛒 Shopee';
    case 'mercadolivre': return '📦 Mercado Livre';
    case 'amazon': return '📦 Amazon';
    default: return '❓ Desconhecido';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Component ──────────────────────────────────────

export function MirrorLogsPage({ token }: MirrorLogsPageProps) {
  const [data, setData] = useState<MirrorLogResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [marketplaceFilter, setMarketplaceFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const pageSize = 25;

  const isMobile = useMediaQuery('(max-width: 768px)');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (p > 1) params.set('page', String(p));
      if (statusFilter) params.set('status', statusFilter);
      if (marketplaceFilter) params.set('marketplace', marketplaceFilter);
      if (searchText) params.set('search', searchText);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const res = await fetch(`/api/affiliate/mirror-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as MirrorLogResponse;
      if (json.success) setData(json);
    } catch {
      // Silencioso
    }
    setLoading(false);
  }, [token, statusFilter, marketplaceFilter, searchText, dateFrom, dateTo]);

  // Initial fetch on mount
  useEffect(() => {
    fetchLogs(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desktop: auto-filtro com debounce (300ms) quando qualquer filtro muda
  useEffect(() => {
    if (isMobile) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, marketplaceFilter, searchText, dateFrom, dateTo, isMobile]);

  // Fetch na mudança de página (paginação) ou fetchKey (reset/search)
  useEffect(() => {
    fetchLogs(page);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fetchKey]);

  function handleSearch() {
    setPage(1);
    setFetchKey(n => n + 1);
  }

  function handleReset() {
    setStatusFilter('');
    setMarketplaceFilter('');
    setSearchText('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
    setFetchKey(n => n + 1);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
  }

  return (
    <PageLayout maxWidth="960px">
      <PageHeader
        title="📋 Logs de Espelhamento"
        subtitle={data ? `${data.total} registro(s)` : 'Carregando...'}
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => fetchLogs(page)}
              disabled={loading}
              icon={<RotateCw size={14} className={loading ? 'spin' : ''} />}
            >
              Atualizar
            </Button>
          </div>
        }
      />

      {/* Filters */}
      {isMobile ? (
        <MobileFilterBar
          label="Filtros"
          actions={
            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
              <Button variant="ghost" size="md" onClick={handleReset} icon={<X size={14} />} style={{ flex: 1 }}>
                Limpar
              </Button>
              <Button onClick={handleSearch} loading={loading} icon={<Search size={14} />} size="md" style={{ flex: 1 }}>
                Filtrar
              </Button>
            </div>
          }
        >
          <div style={{ width: '100%' }}>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.3rem' }}>
              Buscar
            </label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if ((e as unknown as { key: string }).key === 'Enter') handleSearch(); }}
              placeholder="Link ou texto..."
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <Select
            label="Status"
            value={statusFilter}
            onValueChange={setStatusFilter}
            placeholder="Todos"
            options={[
              { value: '', label: 'Todos' },
              { value: 'sent', label: 'Enviada' },
              { value: 'blocked', label: 'Bloqueada' },
              { value: 'failed', label: 'Falha' },
            ]}
          />
          <Select
            label="Marketplace"
            value={marketplaceFilter}
            onValueChange={setMarketplaceFilter}
            placeholder="Todos"
            options={[
              { value: '', label: 'Todos' },
              { value: 'shopee', label: 'Shopee' },
              { value: 'mercadolivre', label: 'Mercado Livre' },
              { value: 'amazon', label: 'Amazon' },
              { value: 'unknown', label: 'Desconhecido' },
            ]}
          />
          <div style={{ width: '100%' }}>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.3rem' }}>
              De
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom((e.target as HTMLInputElement).value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ width: '100%' }}>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.3rem' }}>
              Até
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo((e.target as HTMLInputElement).value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </MobileFilterBar>
      ) : (
        <FilterBar title="Filtros" action={
          <Button variant="ghost" size="md" onClick={handleReset} icon={<X size={14} />}>
            Limpar
          </Button>
        }>
          <FilterBar.Item width="200px" grow={2}>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.3rem' }}>
              Buscar
            </label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if ((e as unknown as { key: string }).key === 'Enter') handleSearch(); }}
              placeholder="Link ou texto..."
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </FilterBar.Item>
          <FilterBar.Item width="150px">
            <Select
              label="Status"
              value={statusFilter}
              onValueChange={setStatusFilter}
              placeholder="Todos"
              options={[
                { value: '', label: 'Todos' },
                { value: 'sent', label: 'Enviada' },
                { value: 'blocked', label: 'Bloqueada' },
                { value: 'failed', label: 'Falha' },
              ]}
            />
          </FilterBar.Item>
          <FilterBar.Item width="150px">
            <Select
              label="Marketplace"
              value={marketplaceFilter}
              onValueChange={setMarketplaceFilter}
              placeholder="Todos"
              options={[
                { value: '', label: 'Todos' },
                { value: 'shopee', label: 'Shopee' },
                { value: 'mercadolivre', label: 'Mercado Livre' },
                { value: 'amazon', label: 'Amazon' },
                { value: 'unknown', label: 'Desconhecido' },
              ]}
            />
          </FilterBar.Item>
          <FilterBar.Item width="140px" grow={1}>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.3rem' }}>
              De
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom((e.target as HTMLInputElement).value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </FilterBar.Item>
          <FilterBar.Item width="140px" grow={1}>
            <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: '0.3rem' }}>
              Até
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo((e.target as HTMLInputElement).value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </FilterBar.Item>
        </FilterBar>
      )}

      {/* Table */}
      <Card>
        {loading && !data ? (
          <LoadingSkeleton lines={6} />
        ) : !data || data.rows.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            Nenhum registro encontrado
          </div>
        ) : (
          <div>
            {data.rows.map((row) => {
              const st = statusBadge(row.status);
              const isExpanded = expandedId === row.id;

              return (
                <div
                  key={row.id}
                  onClick={() => setExpandedId(isExpanded ? null : row.id)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderBottom: '1px solid var(--color-border-light)',
                    cursor: 'pointer',
                    background: isExpanded ? 'var(--color-bg-secondary)' : 'transparent',
                    transition: 'background var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface-hover)'; }}
                  onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  {/* Main row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <Badge variant={st.variant}>{st.label}</Badge>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                      {marketplaceLabel(row.marketplace)}
                    </span>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                      {row.sourceGroupName || row.sourceGroupJid.slice(0, 20)}
                      <span style={{ color: 'var(--color-text-muted)', margin: '0 0.25rem' }}>→</span>
                      {row.targetGroupName || row.targetGroupJid.slice(0, 20) || '(—)'}
                    </span>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      {formatDate(row.reflectedAt)}
                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </span>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Link original:</span>
                        <div
                          style={{
                            marginTop: '0.15rem',
                            padding: '0.4rem 0.5rem',
                            background: 'var(--color-bg)',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--color-border)',
                            wordBreak: 'break-all',
                            color: 'var(--color-text-primary)',
                            fontSize: 'var(--text-xs)',
                            fontFamily: 'var(--font-mono)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <span style={{ flex: 1, minWidth: 0 }}>{row.originalLink}</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); copyToClipboard(row.originalLink); }}
                            style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', padding: '0.2rem', flexShrink: 0 }}
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>

                      {row.convertedLink && row.convertedLink !== row.originalLink && (
                        <div>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Link convertido:</span>
                          <div
                            style={{
                              marginTop: '0.15rem',
                              padding: '0.4rem 0.5rem',
                              background: 'var(--color-success-subtle)',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--color-success-light)',
                              wordBreak: 'break-all',
                              color: 'var(--color-success)',
                              fontSize: 'var(--text-xs)',
                              fontFamily: 'var(--font-mono)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.5rem',
                            }}
                          >
                            <span style={{ flex: 1, minWidth: 0 }}>{row.convertedLink}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); copyToClipboard(row.convertedLink); }}
                              style={{ background: 'none', border: 'none', color: 'var(--color-success)', cursor: 'pointer', padding: '0.2rem', flexShrink: 0 }}
                            >
                              <Copy size={12} />
                            </button>
                          </div>
                        </div>
                      )}

                      {row.failureReason && (
                        <div>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error)' }}>Motivo:</span>
                          <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)', marginTop: '0.15rem' }}>
                            {row.failureReason}
                          </div>
                        </div>
                      )}

                      {row.messagePreview && (
                        <div>
                          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Preview:</span>
                          <div
                            style={{
                              color: 'var(--color-text-primary)',
                              fontSize: 'var(--text-xs)',
                              marginTop: '0.15rem',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              maxHeight: '100px',
                              overflow: 'hidden',
                            }}
                          >
                            {row.messagePreview.slice(0, 300)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {data && data.totalPages > 1 && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderTop: '1px solid var(--color-border-light)',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: 'var(--text-sm)',
            }}
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ← Anterior
            </Button>
            <span style={{ color: 'var(--color-text-muted)', padding: '0 0.5rem' }}>
              Página {data.page} de {data.totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima →
            </Button>
          </div>
        )}
      </Card>
    </PageLayout>
  );
}
