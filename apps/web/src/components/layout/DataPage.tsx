/**
 * DataPage — Template padronizado para páginas de listagem com dados
 *
 * Encapsula PageLayout, PageHeader, filtros responsivos, tabela com
 * loading/empty/erro, e paginação.
 *
 * Subcomponentes:
 *   DataPage.Desktop  — conteúdo exclusivo para desktop
 *   DataPage.Mobile   — conteúdo exclusivo para mobile
 *   DataPage.Table    — wrapper para tabela HTML padronizada
 *   DataPage.Content  — wrapper para conteúdo customizado (ex: linhas expansíveis)
 *
 * Uso com filtros + conteúdo compartilhado:
 *   <DataPage title="📋 Meus Registros" total={data?.total} loading={loading}
 *             onRefresh={handleRefresh} pagination={...}>
 *     <DataPage.Desktop>
 *       <FilterBar title="Filtros" action={...}>...</FilterBar>
 *     </DataPage.Desktop>
 *     <DataPage.Mobile>
 *       <MobileFilterBar label="Filtros" actions={...}>...</MobileFilterBar>
 *     </DataPage.Mobile>
 *
 *     <DataPage.Table>
 *       {data?.rows.map(row => <tr key={row.id}>...</tr>)}
 *     </DataPage.Table>
 *   </DataPage>
 *
 * Uso com conteúdo customizado (ex: MirrorLogsPage):
 *   <DataPage title="📋 Logs" ...>
 *     <DataPage.Desktop>
 *       <FilterBar ...>...</FilterBar>
 *     </DataPage.Desktop>
 *     <DataPage.Mobile>
 *       <MobileFilterBar ...>...</MobileFilterBar>
 *     </DataPage.Mobile>
 *
 *     <DataPage.Content>
 *       {data?.rows.map(row => <div key={row.id}>...</div>)}
 *     </DataPage.Content>
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

// ─── Marker components ────────────────────────────────────────────

interface SlotProps {
  children: React.ReactNode;
}

function DesktopSlot({ children }: SlotProps) {
  const isDesktop = !useMediaQuery('(max-width: 768px)');
  if (!isDesktop) return null;
  return <>{children}</>;
}

function MobileSlot({ children }: SlotProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  if (!isMobile) return null;
  return <>{children}</>;
}

function TableSlot({ children }: SlotProps) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>{children}</table></div>;
}

function ContentSlot({ children }: SlotProps) {
  return <div>{children}</div>;
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
  // Separa os children por tipo: Desktop, Mobile e conteúdo
  const desktopElements: React.ReactNode[] = [];
  const mobileElements: React.ReactNode[] = [];
  const contentElements: React.ReactNode[] = [];

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) {
      contentElements.push(child);
      return;
    }
    const type = child.type as React.ComponentType | undefined;
    if (type === DesktopSlot) {
      // Extrai o conteúdo do slot (o que estava dentro de <DataPage.Desktop>)
      React.Children.forEach(child.props.children, (c) => desktopElements.push(c));
    } else if (type === MobileSlot) {
      React.Children.forEach(child.props.children, (c) => mobileElements.push(c));
    } else {
      contentElements.push(child);
    }
  });

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

      {/* ── Filtros responsivos ────────────────────────── */}
      {mobileElements.length > 0 && <MobileSlotWrapper>{mobileElements}</MobileSlotWrapper>}
      {desktopElements.length > 0 && <DesktopSlotWrapper>{desktopElements}</DesktopSlotWrapper>}

      {/* ── Tabela / Lista ─────────────────────────────── */}
      <Card>
        {loading && !error ? (
          <LoadingSkeleton lines={loadingSkeletonLines} />
        ) : error ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            <p style={{ color: 'var(--color-error)', marginBottom: '0.75rem' }}>{error}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Tentar novamente
              </Button>
            )}
          </div>
        ) : empty ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {emptyMessage}
          </div>
        ) : (
          <div>{contentElements}</div>
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

// ─── Wrappers responsivos (com useMediaQuery interno) ────────────

function MobileSlotWrapper({ children }: { children: React.ReactNode }) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  if (!isMobile) return null;
  return <>{children}</>;
}

function DesktopSlotWrapper({ children }: { children: React.ReactNode }) {
  const isDesktop = !useMediaQuery('(max-width: 768px)');
  if (!isDesktop) return null;
  return <>{children}</>;
}

// ─── Subcomponentes públicos ──────────────────────────────────────

DataPage.Desktop = DesktopSlot;
DataPage.Mobile = MobileSlot;
DataPage.Table = TableSlot;
DataPage.Content = ContentSlot;
