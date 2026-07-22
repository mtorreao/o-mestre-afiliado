/**
 * MirrorLogs — Tela de logs de mensagens espelhadas.
 *
 * Exibe tabela com filtros por grupo, status, marketplace, período e busca textual.
 */
import { useState, useEffect, useCallback } from 'react';

// ─── Tipos ───────────────────────────────────────────────────────────

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

interface MirrorLogsProps {
  token: string;
  onBack: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function statusLabel(status: string): { label: string; color: string } {
  switch (status) {
    case 'sent':
      return { label: 'Enviada', color: '#4ade80' };
    case 'failed':
      return { label: 'Falha', color: '#f87171' };
    case 'blocked':
      return { label: 'Bloqueada', color: '#fb923c' };
    default:
      return { label: status, color: '#94a3b8' };
  }
}

function marketplaceLabel(mp: string): string {
  switch (mp) {
    case 'shopee':
      return '🛒 Shopee';
    case 'mercadolivre':
      return '📦 Mercado Livre';
    case 'amazon':
      return '📦 Amazon';
    default:
      return '❓ Desconhecido';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Componente ──────────────────────────────────────────────────────

export function MirrorLogs({ token, onBack }: MirrorLogsProps) {
  const [data, setData] = useState<MirrorLogResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Filtros
  const [statusFilter, setStatusFilter] = useState('');
  const [marketplaceFilter, setMarketplaceFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const pageSize = 25;

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (p > 1) params.set('page', String(p));
      if (pageSize !== 25) params.set('pageSize', String(pageSize));
      if (statusFilter) params.set('status', statusFilter);
      if (marketplaceFilter) params.set('marketplace', marketplaceFilter);
      if (searchText) params.set('search', searchText);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);

      const res = await fetch(`/api/affiliate/mirror-logs?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json() as MirrorLogResponse;
      if (json.success) {
        setData(json);
      }
    } catch {
      // ignore
    }
    setLoading(false);
  }, [token, statusFilter, marketplaceFilter, searchText, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs(page);
  }, [page, fetchLogs]);

  function handleSearch() {
    setPage(1);
    fetchLogs(1);
  }

  function handleReset() {
    setStatusFilter('');
    setMarketplaceFilter('');
    setSearchText('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

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
      <div style={{ maxWidth: '960px', margin: '0 auto' }}>
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
            <h1 style={{ margin: 0, fontSize: '1.3rem' }}>📋 Logs de Espelhamento</h1>
          </div>
          {data && (
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              {data.total} registro(s)
            </span>
          )}
        </div>

        {/* Filtros */}
        <div
          style={{
            background: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #334155',
            padding: '1rem 1.25rem',
            marginBottom: '1rem',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            alignItems: 'flex-end',
          }}
        >
          {/* Status */}
          <div style={{ flex: '1 1 140px', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter((e.target as HTMLSelectElement).value)}
              style={{
                width: '100%',
                padding: '0.45rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.85rem',
              }}
            >
              <option value="">Todos</option>
              <option value="sent">Enviada</option>
              <option value="blocked">Bloqueada</option>
              <option value="failed">Falha</option>
            </select>
          </div>

          {/* Marketplace */}
          <div style={{ flex: '1 1 140px', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
              Marketplace
            </label>
            <select
              value={marketplaceFilter}
              onChange={(e) => setMarketplaceFilter((e.target as HTMLSelectElement).value)}
              style={{
                width: '100%',
                padding: '0.45rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.85rem',
              }}
            >
              <option value="">Todos</option>
              <option value="shopee">Shopee</option>
              <option value="mercadolivre">Mercado Livre</option>
              <option value="amazon">Amazon</option>
              <option value="unknown">Desconhecido</option>
            </select>
          </div>

          {/* Data Início */}
          <div style={{ flex: '1 1 140px', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
              De
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom((e.target as HTMLInputElement).value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.85rem',
              }}
            />
          </div>

          {/* Data Fim */}
          <div style={{ flex: '1 1 140px', minWidth: '120px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
              Até
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo((e.target as HTMLInputElement).value)}
              style={{
                width: '100%',
                padding: '0.4rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.85rem',
              }}
            />
          </div>

          {/* Busca textual */}
          <div style={{ flex: '2 1 180px', minWidth: '140px' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
              Buscar
            </label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if ((e as unknown as { key: string }).key === 'Enter') handleSearch();
              }}
              placeholder="Link ou texto da mensagem..."
              style={{
                width: '100%',
                padding: '0.45rem 0.5rem',
                borderRadius: '6px',
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#e2e8f0',
                fontSize: '0.85rem',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Botões */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
            <button
              onClick={handleSearch}
              disabled={loading}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: 'none',
                background: loading ? '#6366f180' : '#6366f1',
                color: 'white',
                fontSize: '0.85rem',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontWeight: 500,
              }}
            >
              {loading ? 'Buscando...' : '🔍 Filtrar'}
            </button>
            <button
              onClick={handleReset}
              style={{
                padding: '0.45rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #475569',
                background: 'transparent',
                color: '#94a3b8',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              Limpar
            </button>
          </div>
        </div>

        {/* Tabela */}
        <div
          style={{
            background: '#1e293b',
            borderRadius: '12px',
            border: '1px solid #334155',
            overflow: 'hidden',
          }}
        >
          {loading && !data ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              Carregando...
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
              Nenhum registro encontrado
            </div>
          ) : (
            <div>
              {/* Cabeçalho da tabela */}
              <div
                style={{
                  display: 'none',
                }}
              >
                {/* Header hidden on mobile — we use row layout */}
              </div>

              {/* Linhas */}
              {data.rows.map((row) => {
                const st = statusLabel(row.status);
                const isExpanded = expandedId === row.id;

                return (
                  <div
                    key={row.id}
                    onClick={() => setExpandedId(isExpanded ? null : row.id)}
                    style={{
                      padding: '0.75rem 1rem',
                      borderBottom: '1px solid #1e293b',
                      cursor: 'pointer',
                      background: isExpanded ? '#0f172a' : 'transparent',
                      transition: 'background 0.15s',
                    }}
                  >
                    {/* Linha principal — info compacta */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {/* Status badge */}
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '0.15rem 0.5rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          background: `${st.color}20`,
                          color: st.color,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {st.label}
                      </span>

                      {/* Marketplace */}
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {marketplaceLabel(row.marketplace)}
                      </span>

                      {/* Grupos */}
                      <span style={{ fontSize: '0.8rem', color: '#e2e8f0' }}>
                        {row.sourceGroupName || row.sourceGroupJid.slice(0, 20)}
                        <span style={{ color: '#64748b', margin: '0 0.25rem' }}>→</span>
                        {row.targetGroupName || row.targetGroupJid.slice(0, 20) || '(—)'}
                      </span>

                      {/* Data */}
                      <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: 'auto' }}>
                        {formatDate(row.reflectedAt)}
                      </span>
                    </div>

                    {/* Expandido — detalhes */}
                    {isExpanded && (
                      <div style={{ marginTop: '0.75rem', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {/* Link original */}
                        <div>
                          <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Link original:</span>
                          <div
                            style={{
                              marginTop: '0.15rem',
                              padding: '0.4rem 0.5rem',
                              background: '#1e293b',
                              borderRadius: '6px',
                              border: '1px solid #334155',
                              wordBreak: 'break-all',
                              color: '#a5b4fc',
                              fontSize: '0.8rem',
                            }}
                          >
                            {row.originalLink}
                          </div>
                        </div>

                        {/* Link convertido */}
                        {row.convertedLink && row.convertedLink !== row.originalLink && (
                          <div>
                            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Link convertido:</span>
                            <div
                              style={{
                                marginTop: '0.15rem',
                                padding: '0.4rem 0.5rem',
                                background: '#1e293b',
                                borderRadius: '6px',
                                border: '1px solid #4ade8040',
                                wordBreak: 'break-all',
                                color: '#86efac',
                                fontSize: '0.8rem',
                              }}
                            >
                              {row.convertedLink}
                            </div>
                          </div>
                        )}

                        {/* Motivo (se bloqueada/falha) */}
                        {row.failureReason && (
                          <div>
                            <span style={{ color: '#f87171', fontSize: '0.75rem' }}>Motivo:</span>
                            <div style={{ color: '#fca5a5', fontSize: '0.85rem', marginTop: '0.15rem' }}>
                              {row.failureReason}
                            </div>
                          </div>
                        )}

                        {/* Preview da mensagem */}
                        {row.messagePreview && (
                          <div>
                            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Preview:</span>
                            <div
                              style={{
                                color: '#cbd5e1',
                                fontSize: '0.8rem',
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

                        {/* JIDs brutos */}
                        <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '0.25rem' }}>
                          <div>Origem JID: {row.sourceGroupJid}</div>
                          <div>Destino JID: {row.targetGroupJid || '(n/a)'}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Paginação */}
        {data && data.totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.5rem',
              marginTop: '1rem',
              fontSize: '0.85rem',
            }}
          >
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #475569',
                background: 'transparent',
                color: page <= 1 ? '#475569' : '#94a3b8',
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              ← Anterior
            </button>
            <span style={{ color: '#94a3b8' }}>
              Página {data.page} de {data.totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(data.totalPages, p + 1))}
              disabled={page >= data.totalPages || loading}
              style={{
                padding: '0.4rem 0.75rem',
                borderRadius: '6px',
                border: '1px solid #475569',
                background: 'transparent',
                color: page >= data.totalPages ? '#475569' : '#94a3b8',
                cursor: page >= data.totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Próxima →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
