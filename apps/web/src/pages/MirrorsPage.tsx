/**
 * MirrorsPage — Lista de espelhamentos (mirrors)
 *
 * Tabela paginada com busca textual, toggle de status e exclusão.
 * Em mobile (≤768px) a DataPage.Table renderiza cards automaticamente.
 *
 * Consome GET /api/mirrors, PATCH /api/mirrors/:id/status, DELETE /api/mirrors/:id.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Badge, Dialog, FilterBar, Input, MobileFilterBar } from '../components/ui/index.ts';
import { DataPage } from '../components/layout/DataPage.tsx';
import { useToast } from '../components/ui/Toast.tsx';
import {
  Search,
  RotateCw,
  Eye,
  Edit3,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import type { TableColumn } from '../components/layout/DataPage.tsx';

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
  subRateLimitMaxMsgs: number | null;
  subRateLimitWindowSec: number | null;
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
  const navigate = useNavigate();

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

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  // ─── Column config (shared: desktop table + mobile cards) ──────

  const toggleExpand = (id: number) => setExpandedId(expandedId === id ? null : id);

  const columns: TableColumn<Mirror>[] = [
    {
      label: 'Nome',
      width: 'minmax(180px, 1fr)',
      render: (r: Mirror) => (
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{r.name}</span>
      ),
    },
    {
      label: 'Status',
      width: '100px',
      render: (r: Mirror) => (
        <Badge variant={r.status === 'active' ? 'success' : 'neutral'}>{r.status === 'active' ? 'Ativo' : 'Inativo'}</Badge>
      ),
    },
    {
      label: 'Criado em',
      width: '110px',
      render: (r: Mirror) => (
        <span style={{ color: 'var(--color-text-secondary)' }}>{formatDate(r.createdAt)}</span>
      ),
    },
    {
      label: 'Ações',
      width: '170px',
      align: 'right',
      render: (r: Mirror) => (
        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" icon={<Eye size={14} />} title="Ver detalhes" onClick={() => toggleExpand(r.id)} />
          <Button variant="ghost" size="sm" icon={<Edit3 size={14} />} title="Editar" onClick={() => navigate(`/mirror-form/${r.id}`)} />
          <Button variant="ghost" size="sm" icon={r.status === 'active' ? <PowerOff size={14} /> : <Power size={14} />} title={r.status === 'active' ? 'Desativar' : 'Ativar'} onClick={() => handleToggleStatus(r)} />
          <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} title="Excluir" style={{ color: 'var(--color-error)' }} onClick={() => setDeleteTarget(r)} />
        </div>
      ),
    },
  ];

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

  // Desktop: auto-filtro com debounce (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPage(1);
      setFetchKey(n => n + 1);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Fetch na mudança de página ou fetchKey
  useEffect(() => {
    fetchMirrors(page, searchText);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, fetchKey]);

  function handleSearch() {
    setPage(1);
    setFetchKey(n => n + 1);
  }

  function handleReset() {
    setSearchText('');
    setPage(1);
    setFetchKey(n => n + 1);
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

  // ─── Render helpers ─────────────────────────────────────────────

  const renderExpanded = (r: Mirror) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: 'var(--text-sm)' }}>
      <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Grupos de origem: </span><span style={{ color: 'var(--color-text-primary)' }}>{r.sourceGroups?.length ? r.sourceGroups.map((g) => g.name || g.jid).join(', ') : '(nenhum)'}</span></div>
      <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Grupos de destino: </span><span style={{ color: 'var(--color-text-primary)' }}>{r.targetGroups?.length ? r.targetGroups.map((g) => g.name || g.jid).join(', ') : '(nenhum)'}</span></div>
      {r.messageTemplate && <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Template: </span><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{r.messageTemplate}</span></div>}
      {(r.subRateLimitMaxMsgs != null || r.subRateLimitWindowSec != null) && <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Limite: </span><span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>{r.subRateLimitMaxMsgs ?? 5} msg / {r.subRateLimitWindowSec ?? 300}s</span></div>}
      <div><span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Última atualização: {formatDate(r.updatedAt)}</span></div>
    </div>
  );

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <DataPage
      title="📋 Espelhamentos"
      total={data?.total}
      loading={loading}
      error={error}
      onRefresh={() => fetchMirrors(page, searchText)}
      onRetry={() => fetchMirrors(page, searchText)}
      empty={!!data && data.rows.length === 0}
      emptyMessage={searchText ? 'Nenhum espelhamento encontrado para esta busca.' : 'Nenhum espelhamento cadastrado ainda.'}
      pagination={data ? { page: data.page, totalPages: data.totalPages, onPageChange: (p) => setPage(p) } : null}
      headerActions={
        <Button variant="primary" size="md" onClick={() => navigate('/mirror-form')} icon={<Edit3 size={14} />}>
          Novo
        </Button>
      }
    >
      <DataPage.Mobile>
        <MobileFilterBar
          label="Filtros"
          actions={
            <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
              <Button variant="ghost" size="md" onClick={handleReset} icon={<RotateCw size={14} />} style={{ flex: 1 }}>Limpar</Button>
              <Button onClick={handleSearch} loading={loading} icon={<Search size={14} />} size="md" style={{ flex: 1 }}>Buscar</Button>
            </div>
          }
        >
          <Input label="Buscar por nome" placeholder="Digite o nome do espelhamento..." value={searchText} onChange={(e) => setSearchText(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }} />
        </MobileFilterBar>
      </DataPage.Mobile>

      <DataPage.Desktop>
        <FilterBar title="Filtros" action={<Button variant="ghost" size="md" onClick={handleReset} icon={<RotateCw size={14} />}>Limpar</Button>}>
          <FilterBar.Item width="280px" grow={2}>
            <Input label="Buscar por nome" placeholder="Digite o nome do espelhamento..." value={searchText} onChange={(e) => setSearchText(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }} />
          </FilterBar.Item>
        </FilterBar>
      </DataPage.Desktop>

      <DataPage.Table
        columns={columns}
        data={data?.rows}
        keyExtractor={(r: Mirror) => r.id}
        onRowClick={(r: Mirror) => toggleExpand(r.id)}
        expandedRow={expandedId}
        renderExpanded={renderExpanded}
      />

      {/* Delete confirmation — fora dos slots pra funcionar em mobile e desktop */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Excluir espelhamento"
        description={deleteTarget ? `Tem certeza que deseja excluir "${deleteTarget.name}"? Esta ação não pode ser desfeita.` : ''}
      >
        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
          <Button variant="secondary" size="sm" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" size="sm" loading={deleting} onClick={handleConfirmDelete}>
            {deleting ? 'Excluindo...' : 'Sim, excluir'}
          </Button>
        </div>
      </Dialog>
    </DataPage>
  );
}
