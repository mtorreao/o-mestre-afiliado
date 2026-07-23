/**
 * DataPage — Template padronizado para páginas de listagem com dados
 *
 * Encapsula PageLayout, PageHeader, área de filtros, tabela com
 * loading/empty/erro, e paginação — padronizando o layout e evitando
 * repetição entre páginas como MirrorLogsPage e MirrorsPage.
 *
 * Uso:
 *   <DataPage
 *     title="📋 Meus Registros"
 *     total={data?.total}
 *     loading={loading}
 *     error={error}
 *     onRefresh={() => fetchData(page)}
 *     onRetry={handleRetry}
 *     empty={data && data.rows.length === 0}
 *     emptyMessage="Nenhum registro encontrado"
 *     filters={<FilterBar title="Filtros" action={...}>... </FilterBar>}
 *     mobileFilters={<MobileFilterBar ...>...</MobileFilterBar>}
 *     pagination={data ? { page: data.page, totalPages: data.totalPages, onPageChange: setPage } : undefined}
 *     headerActions={<Button>Novo</Button>}
 *   >
 *     {data?.rows.map(row => (
 *       <div key={row.id}>conteúdo da linha</div>
 *     ))}
 *   </DataPage>
 */
import React from 'react';
import { RotateCw } from 'lucide-react';
import { PageLayout } from './PageLayout.tsx';
import { PageHeader } from './PageHeader.tsx';
import { Card, Button, LoadingSkeleton } from '../ui/index.ts';

interface PaginationInfo {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

interface DataPageProps {
  /** Título da página (no PageHeader) */
  title: string;
  /** Subtítulo opcional */
  subtitle?: string;
  /** Total de registros (exibido ao lado do título) */
  total?: number;
  /** Estado de carregamento */
  loading?: boolean;
  /** Mensagem de erro (exibe estado de erro com retry) */
  error?: string | null;
  /** Callback de refresh (botão Atualizar) */
  onRefresh?: () => void;
  /** Callback de retry (estado de erro) */
  onRetry?: () => void;
  /** Se true, exibe mensagem de vazio */
  empty?: boolean;
  /** Mensagem de lista vazia */
  emptyMessage?: string;
  /** Filtros para desktop (renderizados inline) */
  filters?: React.ReactNode;
  /** Filtros para mobile (renderizados como botão + BottomSheet) */
  mobileFilters?: React.ReactNode;
  /** Botões extras no PageHeader (ex: Novo) */
  headerActions?: React.ReactNode;
  /** Configuração de paginação */
  pagination?: PaginationInfo | null;
  /** Quantidade de linhas do esqueleto de loading */
  loadingSkeletonLines?: number;
  /** Conteúdo da lista/tabela */
  children: React.ReactNode;
}

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
  filters,
  mobileFilters,
  headerActions,
  pagination,
  loadingSkeletonLines = 6,
  children,
}: DataPageProps) {
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

      {/* ── Filtros ────────────────────────────────────── */}
      {mobileFilters}
      {filters}

      {/* ── Tabela / Lista ─────────────────────────────── */}
      <Card>
        {loading && !error ? (
          <LoadingSkeleton lines={loadingSkeletonLines} />
        ) : error ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            <p style={{ color: 'var(--color-error)', marginBottom: '0.75rem' }}>
              {error}
            </p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Tentar novamente
              </Button>
            )}
          </div>
        ) : empty ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          <div>
            {children}
          </div>
        )}

        {/* ── Paginação ──────────────────────────────────── */}
        {pagination && pagination.totalPages > 1 && (
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
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(Math.max(1, pagination.page - 1))}
            >
              ← Anterior
            </Button>
            <span style={{ color: 'var(--color-text-muted)', padding: '0 0.5rem' }}>
              Página {pagination.page} de {pagination.totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Próxima →
            </Button>
          </div>
        )}
      </Card>
    </PageLayout>
  );
}
