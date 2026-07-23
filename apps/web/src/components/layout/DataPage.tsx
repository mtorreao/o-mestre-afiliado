/**
 * DataPage — Template padronizado para páginas de listagem com dados
 *
 * Encapsula PageLayout, PageHeader, filtros responsivos, tabela com
 * loading/empty/erro, e paginação.
 *
 * Subcomponentes:
 *   DataPage.Desktop  — conteúdo exclusivo para desktop (>768px)
 *   DataPage.Mobile   — conteúdo exclusivo para mobile (≤768px)
 *   DataPage.Table    — wrapper para tabela HTML padronizada
 *   DataPage.Content  — wrapper para conteúdo customizado (ex: linhas expansíveis)
 *
 * Uso:
 *   <DataPage title="📋 Meus Registros" total={data?.total}
 *             loading={loading} onRefresh={handleRefresh}
 *             pagination={data ? { page, totalPages, onPageChange: setPage } : null}
 *             headerActions={<Button>Novo</Button>}>
 *     <DataPage.Desktop>
 *       <FilterBar title="Filtros" action={<Button>Limpar</Button>}>...</FilterBar>
 *     </DataPage.Desktop>
 *     <DataPage.Mobile>
 *       <MobileFilterBar label="Filtros" actions={...}>...</MobileFilterBar>
 *     </DataPage.Mobile>
 *     <DataPage.Table>
 *       {data?.rows.map(row => <tr key={row.id}>...</tr>)}
 *     </DataPage.Table>
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

// ─── Slot identifiers (marcadores para React.Children) ─────────────

const Desktop = ({ children }: { children: React.ReactNode }) => <>{children}</>;
Desktop.displayName = 'Desktop';

const Mobile = ({ children }: { children: React.ReactNode }) => <>{children}</>;
Mobile.displayName = 'Mobile';

const Table = ({ children }: { children: React.ReactNode }) => (
  <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table>
  </div>
);
Table.displayName = 'Table';

const Content = ({ children }: { children: React.ReactNode }) => <>{children}</>;
Content.displayName = 'Content';

// ─── Helpers ───────────────────────────────────────────────────────

function isDesktop() {
  // SSR-safe: assume desktop se window não está disponível
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
  emptyMessage = 'Nenhum registro encontrado',
  headerActions,
  pagination,
  loadingSkeletonLines = 6,
  children,
}: DataPageProps) {
  // Separa os children por slot: Desktop, Mobile, e o resto (conteúdo)
  const desktopContent: React.ReactNode[] = [];
  const mobileContent: React.ReactNode[] = [];
  const bodyContent: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      bodyContent.push(child);
      return;
    }
    const el = child as React.ReactElement<{ children?: React.ReactNode }>;
    const { children: slotChildren } = el.props;

    switch (el.type) {
      case Desktop:
        if (slotChildren) React.Children.forEach(slotChildren, (c) => desktopContent.push(c));
        break;
      case Mobile:
        if (slotChildren) React.Children.forEach(slotChildren, (c) => mobileContent.push(c));
        break;
      default:
        bodyContent.push(child);
    }
  });

  // Render condicional: mobile vs desktop
  const isWide = isDesktop();

  return (
    <PageLayout maxWidth="960px">
      {/* ── Header ────────────────────────────────────── */}
      <PageHeader
        title={title}
        subtitle={
          subtitle
            ? subtitle
            : total !== undefined
              ? `${total} registro(s)`
              : loading
                ? 'Carregando...'
                : undefined
        }
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {headerActions}
            {onRefresh && (
              <Button
                variant="ghost"
                size="md"
                onClick={onRefresh}
                disabled={loading}
                icon={<RotateCw size={14} className={loading ? 'spin' : ''} />}
              >
                Atualizar
              </Button>
            )}
          </div>
        }
      />

      {/* ── Filtros (uma versão por vez) ───────────────── */}
      {isWide
        ? desktopContent.length > 0 && <>{desktopContent}</>
        : mobileContent.length > 0 && <>{mobileContent}</>
      }

      {/* ── Card com dados ─────────────────────────────── */}
      <Card>
        {loading && !error ? (
          <LoadingSkeleton lines={loadingSkeletonLines} />
        ) : error ? (
          <ErrorState message={error} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState message={emptyMessage} />
        ) : (
          <>{bodyContent}</>
        )}

        {/* ── Paginação ──────────────────────────────────── */}
        {pagination && pagination.totalPages > 1 && (
          <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--color-border-light)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-sm)' }}>
            <Button variant="ghost" size="sm" disabled={pagination.page <= 1} onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}>
              ← Anterior
            </Button>
            <span style={{ color: 'var(--color-text-muted)', padding: '0 0.5rem' }}>
              Página {pagination.page} de {pagination.totalPages}
            </span>
            <Button variant="ghost" size="sm" disabled={pagination.page >= pagination.totalPages} onClick={() => pagination.onPageChange(pagination.page + 1)}>
              Próxima →
            </Button>
          </div>
        )}
      </Card>
    </PageLayout>
  );
}

// ─── Sub-estados ──────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
      <p style={{ color: 'var(--color-error)', marginBottom: '0.75rem' }}>{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
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
DataPage.Table = Table;
DataPage.Content = Content;
