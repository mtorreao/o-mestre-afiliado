/**
 * ProductHistoryPage — Catálogo de produtos + histórico de preços (admin).
 *
 * Especificação: docs/plans/historico-precos.md §5.5.3-5.5.4
 *  - Tabela de produtos (DataPage/DataPage.Table): imagem, título, marketplace,
 *    menor/maior preço, # variações, última vez vista.
 *  - Clique → modal com gráfico de linha do price_history por variação
 *    (SVG inline, sem lib de chart).
 *  - Filtros: marketplace + busca por título.
 *  - Admin-only: página e sidebar filtram por isAdmin (defense in depth —
 *    o backend é a fonte de verdade com 403).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Search, X, ImageOff, Layers, TrendingUp } from 'lucide-react';
import './product-history.css';
import { useAuth } from '../hooks/useAuth.ts';
import { DataPage } from '../components/layout/DataPage.tsx';
import type { TableColumn } from '../components/layout/DataPage.tsx';
import { Badge, Button, Dialog, Input, Select, Card } from '../components/ui/index.ts';
import { FilterBar, MobileFilterBar } from '../components/ui/index.ts';
import { useMediaQuery } from '../hooks/useMediaQuery.ts';
import {
  formatPrice,
  formatDateTime,
  marketplaceLabel,
  marketplaceOptions,
  buildPriceChart,
} from './product-history-pure.ts';

// ─── Tipos (contrato GET /api/catalog/*) ─────────────────────────────

interface CatalogProductSummary {
  id: number;
  marketplace: string;
  marketplaceItemId: string;
  productKey: string;
  title: string | null;
  imageUrl: string | null;
  variationCount: number;
  minPrice: string | null;
  maxPrice: string | null;
  lastSeenAt: string;
  lastCapturedAt: string | null;
}

interface CatalogListResponse {
  success: boolean;
  rows?: CatalogProductSummary[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  error?: string;
}

interface CatalogPricePoint {
  id: number;
  price: string;
  listPrice: string | null;
  currency: string;
  available: boolean;
  stock: number | null;
  capturedAt: string;
  source: string;
}

interface CatalogVariation {
  id: number;
  productId: number;
  variationKey: string;
  variationId: string | null;
  variationName: string | null;
  attributesJson: Record<string, unknown>;
  lastSeenAt: string;
  history: CatalogPricePoint[];
}

interface CatalogDetailResponse {
  success: boolean;
  product?: {
    id: number;
    marketplace: string;
    title: string | null;
    imageUrl: string | null;
    lastSeenAt: string;
  };
  variations?: CatalogVariation[];
  error?: string;
}

// ─── Gráfico de linha (SVG inline) ────────────────────────────────────

function PriceChart({ points, height = 220 }: { points: CatalogPricePoint[]; height?: number }) {
  const model = buildPriceChart(points, { height });

  if (!model.hasData) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          padding: '1.5rem',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-sm)',
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
        }}
      >
        <TrendingUp size={16} />
        Sem histórico de preços para esta variação
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${model.width} ${model.height}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      role="img"
      aria-label="Gráfico do histórico de preços"
    >
      {/* Linhas de grade horizontais + labels de preço */}
      {model.yTicks.map((tick, i) => (
        <g key={i}>
          <line
            x1={40}
            y1={tick.y}
            x2={model.width - 8}
            y2={tick.y}
            stroke="var(--color-border)"
            strokeWidth={1}
            strokeDasharray={i === 0 ? '0' : '3 3'}
          />
          <text x={36} y={tick.y + 3} textAnchor="end" fontSize={10} fill="var(--color-text-muted)">
            {tick.value}
          </text>
        </g>
      ))}

      {/* Labels de data (início/fim) */}
      {model.xLabels.map((label, i) => (
        <text
          key={i}
          x={label.x}
          y={model.height - 6}
          textAnchor={i === 0 ? 'start' : 'end'}
          fontSize={10}
          fill="var(--color-text-muted)"
        >
          {label.value}
        </text>
      ))}

      {/* Linha do preço */}
      <path
        d={model.linePath}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Pontos com tooltip nativo */}
      {model.points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={3.5}
          fill="var(--color-primary)"
          stroke="var(--color-surface)"
          strokeWidth={1.5}
        >
          <title>{p.label}</title>
        </circle>
      ))}
    </svg>
  );
}

// ─── Página ──────────────────────────────────────────────────────────

export function ProductHistoryPage() {
  const { token, isAdmin } = useAuth();
  const [data, setData] = useState<CatalogListResponse | null>(null);
  const [loading, setLoading] = useState(false);

  // Filtros
  const [marketplaceFilter, setMarketplaceFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Modal de detalhe
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CatalogDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const pageSize = 25;
  const isMobile = useMediaQuery('(max-width: 768px)');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const fetchProducts = useCallback(
    async (p: number) => {
      if (!token) return;
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (p > 1) params.set('page', String(p));
        params.set('pageSize', String(pageSize));
        if (marketplaceFilter) params.set('marketplace', marketplaceFilter);
        if (searchText) params.set('search', searchText);

        const res = await fetch(`/api/catalog/products?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as CatalogListResponse;
        if (json.success) setData(json);
      } catch {
        // Silencioso — DataPage mostra vazio
      }
      setLoading(false);
    },
    [token, marketplaceFilter, searchText],
  );

  // Auto-filtro desktop com debounce (mesmo padrão do MirrorLogsPage)
  useEffect(() => {
    if (isMobile) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setFetchKey((n) => n + 1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketplaceFilter, searchText, isMobile]);

  useEffect(() => {
    fetchProducts(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fetchKey]);

  function handleSearch() {
    setPage(1);
    setFetchKey((n) => n + 1);
  }

  function handleReset() {
    setMarketplaceFilter('');
    setSearchText('');
    setPage(1);
    setFetchKey((n) => n + 1);
  }

  // Abre o modal e busca o detalhe do produto
  async function openDetail(id: number) {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    if (token) {
      try {
        const res = await fetch(`/api/catalog/products/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as CatalogDetailResponse;
        setDetail(json);
      } catch {
        setDetail({ success: false, error: 'Erro ao carregar detalhe' });
      }
    }
    setDetailLoading(false);
  }

  // Gate admin (defense in depth — backend é a fonte de verdade)
  if (!isAdmin) {
    return (
      <div style={{ padding: 'var(--spacing-6)' }}>
        <p>Acesso restrito ao administrador.</p>
      </div>
    );
  }

  const columns: TableColumn<CatalogProductSummary>[] = [
    {
      label: 'Produto',
      width: '1fr',
      render: (row) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
          {row.imageUrl ? (
            <img
              src={row.imageUrl}
              alt=""
              loading="lazy"
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                objectFit: 'cover',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg-secondary)',
                flexShrink: 0,
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--radius-sm)',
                background: 'var(--color-bg-secondary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <ImageOff size={14} color="var(--color-text-muted)" />
            </div>
          )}
          <span
            style={{
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.title || 'Sem título'}
          </span>
        </div>
      ),
    },
    {
      label: 'Marketplace',
      width: '140px',
      render: (row) => {
        const mp = marketplaceLabel(row.marketplace);
        return (
          <Badge variant="neutral">
            {mp.emoji} {mp.label}
          </Badge>
        );
      },
    },
    {
      label: 'Menor preço',
      width: '110px',
      align: 'right',
      render: (row) => (
        <span style={{ color: 'var(--color-success)' }}>{formatPrice(row.minPrice)}</span>
      ),
    },
    {
      label: 'Maior preço',
      width: '110px',
      align: 'right',
      render: (row) => <span>{formatPrice(row.maxPrice)}</span>,
    },
    {
      label: 'Variações',
      width: '90px',
      align: 'right',
      render: (row) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
          <Layers size={13} color="var(--color-text-muted)" />
          {row.variationCount}
        </span>
      ),
    },
    {
      label: 'Última vez vista',
      width: '150px',
      render: (row) => (
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-xs)' }}>
          {formatDateTime(row.lastSeenAt)}
        </span>
      ),
    },
  ];

  return (
    <>
      <DataPage
        title="📊 Histórico de Preços"
        total={data?.total}
        loading={loading}
        onRefresh={() => fetchProducts(page)}
        empty={!!data && (data.rows?.length ?? 0) === 0}
        emptyMessage="Nenhum produto no catálogo"
        pagination={
          data
            ? {
                page: data.page ?? 1,
                totalPages: data.totalPages ?? 1,
                onPageChange: (p) => setPage(p),
              }
            : null
        }
      >
        <DataPage.Mobile>
          <MobileFilterBar
            label="Filtros"
            actions={
              <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={handleReset}
                  icon={<X size={14} />}
                  style={{ flex: 1 }}
                >
                  Limpar
                </Button>
                <Button
                  onClick={handleSearch}
                  loading={loading}
                  icon={<Search size={14} />}
                  size="md"
                  style={{ flex: 1 }}
                >
                  Filtrar
                </Button>
              </div>
            }
          >
            <Input
              label="Buscar"
              placeholder="Título do produto..."
              value={searchText}
              onChange={(e) => setSearchText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
            />
            <Select
              label="Marketplace"
              value={marketplaceFilter}
              onValueChange={setMarketplaceFilter}
              placeholder="Todos"
              options={marketplaceOptions()}
            />
          </MobileFilterBar>
        </DataPage.Mobile>

        <DataPage.Desktop>
          <FilterBar
            title="Filtros"
            action={
              <Button variant="ghost" size="md" onClick={handleReset} icon={<X size={14} />}>
                Limpar
              </Button>
            }
          >
            <FilterBar.Item width="220px" grow={2}>
              <Input
                label="Buscar"
                placeholder="Título do produto..."
                value={searchText}
                onChange={(e) => setSearchText(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch();
                }}
              />
            </FilterBar.Item>
            <FilterBar.Item width="180px">
              <Select
                label="Marketplace"
                value={marketplaceFilter}
                onValueChange={setMarketplaceFilter}
                placeholder="Todos"
                options={marketplaceOptions()}
              />
            </FilterBar.Item>
          </FilterBar>
        </DataPage.Desktop>

        <DataPage.Table
          columns={columns}
          data={data?.rows}
          keyExtractor={(r) => r.id}
          onRowClick={(row) => setExpandedId(expandedId === row.id ? null : row.id)}
          expandedRow={expandedId}
          renderExpanded={(row) => (
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button
                variant="outline"
                size="sm"
                icon={<TrendingUp size={14} />}
                onClick={() => openDetail(row.id)}
              >
                Ver histórico de preços
              </Button>
            </div>
          )}
        />
      </DataPage>

      {/* Modal de detalhe — gráfico de linha por variação */}
      <Dialog
        open={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        title={detail?.product?.title || 'Produto'}
        description={
          detail?.product
            ? `${marketplaceLabel(detail.product.marketplace).emoji} ${marketplaceLabel(detail.product.marketplace).label} · visto por último em ${formatDateTime(detail.product.lastSeenAt)}`
            : undefined
        }
        className="ProductHistoryDialog"
      >
        {detailLoading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>
            Carregando...
          </div>
        ) : detail?.error || !detail?.variations ? (
          <div style={{ padding: '1rem', color: 'var(--color-error)' }}>
            {detail?.error ?? 'Erro ao carregar detalhe'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {detail.variations.length === 0 && (
              <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                Nenhuma variação cadastrada.
              </p>
            )}
            {detail.variations.map((v) => (
              <Card key={v.id} style={{ padding: '1rem' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    marginBottom: '0.75rem',
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}
                  >
                    <Layers size={14} color="var(--color-text-muted)" style={{ flexShrink: 0 }} />
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 'var(--text-sm)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {v.variationName || 'Variação padrão'}
                    </span>
                  </div>
                  {v.history.length > 0 && (
                    <Badge variant="info">
                      {v.history.length} {v.history.length === 1 ? 'ponto' : 'pontos'}
                    </Badge>
                  )}
                </div>
                <PriceChart points={v.history} height={200} />

                {v.history.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      gap: '1rem',
                      flexWrap: 'wrap',
                      marginTop: '0.75rem',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <span>
                      Atual:{' '}
                      <strong style={{ color: 'var(--color-text-primary)' }}>
                        {formatPrice(v.history[v.history.length - 1]?.price ?? null)}
                      </strong>
                    </span>
                    <span>
                      Menor:{' '}
                      <strong style={{ color: 'var(--color-success)' }}>
                        {formatPrice(
                          v.history.reduce(
                            (acc, h) => (Number(h.price) < Number(acc) ? h.price : acc),
                            v.history[0]?.price ?? '0',
                          ),
                        )}
                      </strong>
                    </span>
                    <span>
                      Maior:{' '}
                      <strong style={{ color: 'var(--color-text-primary)' }}>
                        {formatPrice(
                          v.history.reduce(
                            (acc, h) => (Number(h.price) > Number(acc) ? h.price : acc),
                            v.history[0]?.price ?? '0',
                          ),
                        )}
                      </strong>
                    </span>
                    <span>
                      Última captura:{' '}
                      <strong style={{ color: 'var(--color-text-primary)' }}>
                        {formatDateTime(v.history[v.history.length - 1]?.capturedAt ?? null)}
                      </strong>
                    </span>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </Dialog>
    </>
  );
}
