/**
 * DataPage — Template padronizado para páginas de listagem com dados
 *
 * Encapsula PageLayout, PageHeader, filtros responsivos, tabela com
 * loading/empty/erro, e paginação.
 *
 * Subcomponentes:
 *   DataPage.Desktop — conteúdo exclusivo para desktop (>768px)
 *   DataPage.Mobile  — conteúdo exclusivo para mobile (≤768px)
 *   DataPage.Table   — tabela padronizada com colunas, linhas expansíveis e ações
 *   DataPage.Content — wrapper para conteúdo customizado
 *
 * Uso com tabela:
 *   <DataPage title="📋" total={data?.total} loading={loading}
 *             pagination={{ page, totalPages, onPageChange }} ...>
 *     <DataPage.Desktop>
 *       <FilterBar ...>...</FilterBar>
 *     </DataPage.Desktop>
 *     <DataPage.Mobile>
 *       <MobileFilterBar ...>...</MobileFilterBar>
 *     </DataPage.Mobile>
 *     <DataPage.Table
 *       columns={[
 *         { label: 'Nome', width: '1fr', render: (row) => row.name },
 *         { label: 'Status', width: '100px', render: (row) => <Badge>...</Badge> },
 *       ]}
 *       data={data?.rows}
 *       keyExtractor={(r) => r.id}
 *       onRowClick={(r) => setExpanded(r.id)}
 *       expandedRow={expandedId}
 *       renderExpanded={(r) => <Details .../>}
 *     />
 *   </DataPage>
 */
import React from 'react';
import { RotateCw } from 'lucide-react';
import { PageLayout } from './PageLayout.tsx';
import { PageHeader } from './PageHeader.tsx';
import { Card, Button, LoadingSkeleton } from '../ui/index.ts';
import { useMediaQuery } from '../../hooks/useMediaQuery.ts';

// ─── Tipos ─────────────────────────────────────────────────────────

interface PaginationInfo {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

interface DataPageProps {
  title: string;
  subtitle?: string;
  total?: number;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
  onRetry?: () => void;
  empty?: boolean;
  emptyMessage?: string;
  headerActions?: React.ReactNode;
  pagination?: PaginationInfo | null;
  loadingSkeletonLines?: number;
  children: React.ReactNode;
}

// ─── Table types ───────────────────────────────────────────────────

interface TableColumn<T> {
  label: string;
  width: string;       // CSS grid value, e.g. '1fr', '100px'
  render: (row: T) => React.ReactNode;
  align?: 'left' | 'right' | 'center';
}

interface TableProps<T extends { id: number | string }> {
  columns: TableColumn<T>[];
  data?: T[];
  keyExtractor: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  expandedRow?: string | number | null;
  renderExpanded?: (row: T) => React.ReactNode;
  emptyMessage?: string;
}

// ─── Slot identifiers ──────────────────────────────────────────────

const Desktop = ({ children }: { children: React.ReactNode }) => <>{children}</>;
Desktop.displayName = 'Desktop';

const Mobile = ({ children }: { children: React.ReactNode }) => <>{children}</>;
Mobile.displayName = 'Mobile';

const Content = ({ children }: { children: React.ReactNode }) => <>{children}</>;
Content.displayName = 'Content';

// ─── Helpers ───────────────────────────────────────────────────────

function isDesktop() {
  if (typeof window === 'undefined') return true;
  return window.matchMedia('(min-width: 769px)').matches;
}

// ─── DataPage principal ───────────────────────────────────────────

export function DataPage({
  title,
  subtitle,
  total,
  loading,
  error,
  onRefresh,
  onRetry,
  empty,
  emptyMessage: emptyMsg = 'Nenhum registro encontrado',
  headerActions,
  pagination,
  loadingSkeletonLines = 6,
  children,
}: DataPageProps) {
  const desktopContent: React.ReactNode[] = [];
  const mobileContent: React.ReactNode[] = [];
  const bodyContent: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) { bodyContent.push(child); return; }
    const el = child as React.ReactElement<{ children?: React.ReactNode }>;
    switch (el.type) {
      case Desktop:
        if (el.props.children) React.Children.forEach(el.props.children, (c) => desktopContent.push(c));
        break;
      case Mobile:
        if (el.props.children) React.Children.forEach(el.props.children, (c) => mobileContent.push(c));
        break;
      default:
        bodyContent.push(child);
    }
  });

  const isWide = isDesktop();

  return (
    <PageLayout maxWidth="960px">
      <PageHeader
        title={title}
        subtitle={subtitle || (total !== undefined ? `${total} registro(s)` : loading ? 'Carregando...' : undefined)}
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {headerActions}
            {onRefresh && (
              <Button variant="ghost" size="md" onClick={onRefresh} disabled={loading}
                icon={<RotateCw size={14} className={loading ? 'spin' : ''} />}>
                Atualizar
              </Button>
            )}
          </div>
        }
      />

      {isWide ? desktopContent.length > 0 && <>{desktopContent}</> : mobileContent.length > 0 && <>{mobileContent}</>}

      <Card>
        {loading && !error ? (
          <LoadingSkeleton lines={loadingSkeletonLines} />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState message={emptyMsg} />
        ) : (
          <>{bodyContent}</>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-sm)' }}>
            <Button variant="ghost" size="sm" disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}>← Anterior</Button>
            <span style={{ color: 'var(--color-text-muted)', padding: '0 0.5rem' }}>Página {pagination.page} de {pagination.totalPages}</span>
            <Button variant="ghost" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => pagination.onPageChange(pagination.page + 1)}>Próxima →</Button>
          </div>
        )}
      </Card>
    </PageLayout>
  );
}

// ─── DataPage.Table ────────────────────────────────────────────────

function TableComponent<T extends { id: number | string }>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  expandedRow,
  renderExpanded,
}: TableProps<T>) {
  if (!data || data.length === 0) return null;

  const gridTemplateColumns = columns.map((c) => c.width).join(' ');

  return (
    <div style={{ overflowX: 'auto' }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns, gap: '0.5rem', padding: '0.625rem 1rem', borderBottom: '2px solid var(--color-border)', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {columns.map((col, i) => (
          <span key={i} style={{ textAlign: col.align || 'left' }}>{col.label}</span>
        ))}
      </div>

      {/* Rows */}
      {data.map((row) => {
        const key = keyExtractor(row);
        const isExpanded = expandedRow != null && expandedRow === key;

        return (
          <div key={key}>
            <div
              onClick={() => onRowClick?.(row)}
              style={{ display: 'grid', gridTemplateColumns, gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--color-border-light)', cursor: onRowClick ? 'pointer' : undefined, alignItems: 'center', background: isExpanded ? 'var(--color-bg-secondary)' : 'transparent', transition: 'background var(--transition-fast)' }}
              onMouseEnter={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = 'var(--color-surface-hover)'; }}
              onMouseLeave={(e) => { if (!isExpanded) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {columns.map((col, i) => (
                <div key={i} style={{ textAlign: col.align || 'left', fontSize: 'var(--text-sm)', color: col.align === 'right' ? undefined : 'var(--color-text-primary)' }}>
                  {col.render(row)}
                </div>
              ))}
            </div>

            {isExpanded && renderExpanded && (
              <div style={{ padding: '0.75rem 1rem', background: 'var(--color-bg)', borderBottom: '1px solid var(--color-border-light)' }}>
                {renderExpanded(row)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Sub-estados ──────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
      <p style={{ color: 'var(--color-error)', marginBottom: '0.75rem' }}>{message}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Tentar novamente</Button>}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
      {message}
    </div>
  );
}

// ─── Subcomponentes públicos ──────────────────────────────────────

DataPage.Desktop = Desktop;
DataPage.Mobile = Mobile;
DataPage.Table = TableComponent;
DataPage.Content = Content;
