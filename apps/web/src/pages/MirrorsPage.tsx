/**
 * MirrorsPage — Lista de espelhamentos (mirrors)
 *
 * Tabela paginada com busca textual, toggle de status e exclusão.
 * Consome GET /api/mirrors, PATCH /api/mirrors/:id/status, DELETE /api/mirrors/:id.
 *
 * Estados: loading → LoadingSkeleton, empty → mensagem, error → retry,
 *          dados → tabela com colunas: nome, status, criado em, ações.
 */
import { useState, useEffect, useCallback } from 'react';
import { PageLayout } from '../components/layout/PageLayout.tsx';
import { PageHeader } from '../components/layout/PageHeader.tsx';
import { Card, Button, Badge, LoadingSkeleton, Dialog } from '../components/ui/index.ts';
import { useToast } from '../components/ui/Toast.tsx';
import {
  Search,
  RotateCw,
  Eye,
  Edit3,
  Power,
  PowerOff,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────

interface MirrorGroup {
  jid: string;
  name: string;
}

interface Mirror {
  id: number;
  name: string;
  status: string;
  userId: number | null;
  sourceGroups: MirrorGroup[];
  targetGroups: MirrorGroup[];
  messageTemplate: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MirrorListResponse {
  success: boolean;
  rows: Mirror[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface MirrorsPageProps {
  token: string;
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

// ─── Component ──────────────────────────────────────────────────────

export function MirrorsPage({ token }: MirrorsPageProps) {
  const { addToast } = useToast();

  // Data
  const [data, setData] = useState<MirrorListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  // Expanded row (detalhes)
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<Mirror | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Fetch ──────────────────────────────────────────────────────

  const fetchMirrors = useCallback(
    async (p: number, search?: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('page', String(p));
        params.set('pageSize', String(pageSize));
        if (search) params.set('search', search);

        const res = await fetch(`/api/mirrors?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as MirrorListResponse;
        if (json.success) {
          setData(json);
        } else {
          setError('Resposta inesperada do servidor');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro de conexão');
      }
      setLoading(false);
    },
    [token],
  );

  useEffect(() => {
    fetchMirrors(page, searchText);
  }, [page, fetchMirrors]);

  function handleSearch() {
    setPage(1);
    fetchMirrors(1, searchText);
  }

  function handleReset() {
    setSearchText('');
    setPage(1);
    fetchMirrors(1, '');
  }

  // ─── Status toggle ─────────────────────────────────────────────

  async function handleToggleStatus(mirror: Mirror) {
    const newStatus = mirror.status === 'active' ? 'inactive' : 'active';

    try {
      const res = await fetch(`/api/mirrors/${mirror.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus }),
      });
      const json = (await res.json()) as { success: boolean };
      if (json.success) {
        addToast(
          newStatus === 'active' ? 'Espelhamento ativado' : 'Espelhamento desativado',
          `"${mirror.name}" agora está ${newStatus === 'active' ? 'ativo' : 'inativo'}.`,
          'success',
        );
        // Refetch current page
        fetchMirrors(page, searchText);
      } else {
        addToast('Erro', 'Não foi possível alterar o status.', 'error');
      }
    } catch {
      addToast('Erro', 'Falha de conexão ao alterar status.', 'error');
    }
  }

  // ─── Delete ─────────────────────────────────────────────────────

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/mirrors/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json()) as { success: boolean };
      if (json.success) {
        addToast(
          'Espelhamento excluído',
          `"${deleteTarget.name}" foi removido.`,
          'success',
        );
        setDeleteTarget(null);
        // Refetch — volta para página anterior se estiver na última e ela ficou vazia
        const newPage =
          data && data.rows.length <= 1 && page > 1 ? page - 1 : page;
        setPage(newPage);
        fetchMirrors(newPage, searchText);
      } else {
        addToast('Erro', 'Não foi possível excluir.', 'error');
      }
    } catch {
      addToast('Erro', 'Falha de conexão ao excluir.', 'error');
    }
    setDeleting(false);
  }

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <PageLayout maxWidth="960px">
      <PageHeader
        title="📋 Espelhamentos"
        subtitle={
          data
            ? `${data.total} registro(s)`
            : loading
              ? 'Carregando...'
              : ''
        }
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              icon={<RotateCw size={14} />}
            >
              Limpar
            </Button>
            <Button
              onClick={handleSearch}
              loading={loading}
              icon={<Search size={14} />}
              size="sm"
            >
              Buscar
            </Button>
          </div>
        }
      />

      {/* Search filter */}
      <Card>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 280px' }}>
            <label
              style={{
                display: 'block',
                fontSize: 'var(--text-xs)',
                fontWeight: 500,
                color: 'var(--color-text-secondary)',
                marginBottom: '0.3rem',
              }}
            >
              Buscar por nome
            </label>
            <input
              type="text"
              value={searchText}
              onChange={(e) =>
                setSearchText((e.target as HTMLInputElement).value)
              }
              onKeyDown={(e) => {
                if ((e as unknown as { key: string }).key === 'Enter')
                  handleSearch();
              }}
              placeholder="Digite o nome do espelhamento..."
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
        </div>
      </Card>

      {/* Table */}
      <Card>
        {loading && !data ? (
          <LoadingSkeleton lines={6} />
        ) : error ? (
          /* Error state */
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '0.75rem',
            }}
          >
            <AlertTriangle
              size={32}
              style={{ color: 'var(--color-warning)' }}
            />
            <span
              style={{
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--text-sm)',
              }}
            >
              Erro ao carregar espelhamentos
            </span>
            <span
              style={{
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
              }}
            >
              {error}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchMirrors(page, searchText)}
              icon={<RotateCw size={14} />}
            >
              Tentar novamente
            </Button>
          </div>
        ) : !data || data.rows.length === 0 ? (
          /* Empty state */
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--color-text-muted)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {searchText
              ? 'Nenhum espelhamento encontrado para esta busca.'
              : 'Nenhum espelhamento cadastrado ainda.'}
          </div>
        ) : (
          /* Data rows */
          <>
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'minmax(180px, 1fr) 100px 110px 170px',
                gap: '0.5rem',
                padding: '0.625rem 1rem',
                borderBottom: '2px solid var(--color-border)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--color-text-secondary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              <span>Nome</span>
              <span>Status</span>
              <span>Criado em</span>
              <span style={{ textAlign: 'right' }}>Ações</span>
            </div>

            {/* Table rows */}
            {data.rows.map((mirror) => {
              const isActive = mirror.status === 'active';
              const isExpanded = expandedId === mirror.id;

              return (
                <div key={mirror.id}>
                  {/* Main row */}
                  <div
                    onClick={() =>
                      setExpandedId(isExpanded ? null : mirror.id)
                    }
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'minmax(180px, 1fr) 100px 110px 170px',
                      gap: '0.5rem',
                      padding: '0.75rem 1rem',
                      borderBottom: '1px solid var(--color-border-light)',
                      cursor: 'pointer',
                      alignItems: 'center',
                      background: isExpanded
                        ? 'var(--color-bg-secondary)'
                        : 'transparent',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => {
                      if (!isExpanded)
                        (e.currentTarget as HTMLDivElement).style.background =
                          'var(--color-surface-hover)';
                    }}
                    onMouseLeave={(e) => {
                      if (!isExpanded)
                        (e.currentTarget as HTMLDivElement).style.background =
                          'transparent';
                    }}
                  >
                    {/* Name */}
                    <span
                      style={{
                        fontSize: 'var(--text-sm)',
                        fontWeight: 500,
                        color: 'var(--color-text-primary)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {mirror.name}
                    </span>

                    {/* Status */}
                    <Badge variant={isActive ? 'success' : 'neutral'}>
                      {isActive ? 'Ativo' : 'Inativo'}
                    </Badge>

                    {/* Created at */}
                    <span
                      style={{
                        fontSize: 'var(--text-sm)',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      {formatDate(mirror.createdAt)}
                    </span>

                    {/* Actions */}
                    <div
                      style={{
                        display: 'flex',
                        gap: '0.25rem',
                        justifyContent: 'flex-end',
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Eye size={14} />}
                        title="Ver detalhes"
                        onClick={() =>
                          setExpandedId(
                            isExpanded ? null : mirror.id,
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Edit3 size={14} />}
                        title="Editar"
                        onClick={() =>
                          addToast(
                            'Editar',
                            'Funcionalidade em breve.',
                            'info',
                          )
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={
                          isActive ? (
                            <PowerOff size={14} />
                          ) : (
                            <Power size={14} />
                          )
                        }
                        title={
                          isActive
                            ? 'Desativar'
                            : 'Ativar'
                        }
                        onClick={() => handleToggleStatus(mirror)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        title="Excluir"
                        style={{ color: 'var(--color-error)' }}
                        onClick={() => setDeleteTarget(mirror)}
                      />
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div
                      style={{
                        padding: '0.75rem 1rem',
                        background: 'var(--color-bg)',
                        borderBottom:
                          '1px solid var(--color-border-light)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem',
                        fontSize: 'var(--text-sm)',
                      }}
                    >
                      {/* Source groups */}
                      <div>
                        <span
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-muted)',
                            fontWeight: 500,
                          }}
                        >
                          Grupos de origem:
                        </span>
                        <div
                          style={{
                            marginTop: '0.2rem',
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          {mirror.sourceGroups &&
                          mirror.sourceGroups.length > 0
                            ? mirror.sourceGroups
                                .map((g) => g.name || g.jid)
                                .join(', ')
                            : '(nenhum)'}
                        </div>
                      </div>

                      {/* Target groups */}
                      <div>
                        <span
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-muted)',
                            fontWeight: 500,
                          }}
                        >
                          Grupos de destino:
                        </span>
                        <div
                          style={{
                            marginTop: '0.2rem',
                            color: 'var(--color-text-primary)',
                          }}
                        >
                          {mirror.targetGroups &&
                          mirror.targetGroups.length > 0
                            ? mirror.targetGroups
                                .map((g) => g.name || g.jid)
                                .join(', ')
                            : '(nenhum)'}
                        </div>
                      </div>

                      {/* Message template */}
                      {mirror.messageTemplate && (
                        <div>
                          <span
                            style={{
                              fontSize: 'var(--text-xs)',
                              color: 'var(--color-text-muted)',
                              fontWeight: 500,
                            }}
                          >
                            Template de mensagem:
                          </span>
                          <div
                            style={{
                              marginTop: '0.2rem',
                              padding: '0.4rem 0.5rem',
                              background: 'var(--color-surface)',
                              borderRadius: 'var(--radius-sm)',
                              border:
                                '1px solid var(--color-border)',
                              color: 'var(--color-text-primary)',
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-xs)',
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {mirror.messageTemplate}
                          </div>
                        </div>
                      )}

                      {/* Updated at */}
                      <div>
                        <span
                          style={{
                            fontSize: 'var(--text-xs)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          Última atualização:{' '}
                          {formatDate(mirror.updatedAt)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
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
            <span
              style={{
                color: 'var(--color-text-muted)',
                padding: '0 0.5rem',
              }}
            >
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

      {/* ─── Delete confirmation dialog ─────────────────────────── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Excluir espelhamento"
        description={
          deleteTarget
            ? `Tem certeza que deseja excluir "${deleteTarget.name}"? Esta ação não pode ser desfeita.`
            : ''
        }
      >
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            justifyContent: 'flex-end',
            marginTop: '0.5rem',
          }}
        >
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setDeleteTarget(null)}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={deleting}
            onClick={handleConfirmDelete}
          >
            {deleting ? 'Excluindo...' : 'Sim, excluir'}
          </Button>
        </div>
      </Dialog>
    </PageLayout>
  );
}
