/**
 * MirrorRepository — CRUD para a tabela de espelhamentos (mirrors).
 *
 * Padrão de paginação consistente com MirrorLogRepository.
 * Operações: list (paginado com filtros), findById, create, update, patchStatus, delete.
 */
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { and, eq, desc, count, sql, like } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { mirrors } from '../schema/mirrors.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type Mirror = InferSelectModel<typeof mirrors>;
export type NewMirror = InferInsertModel<typeof mirrors>;

export interface MirrorListFilters {
  status?: string;
  userId?: number;
  search?: string; // busca textual em name
  page?: number;
  pageSize?: number;
}

export interface MirrorListResponse {
  rows: Mirror[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface MirrorUpdateData {
  name?: string;
  status?: string;
  sourceGroups?: { jid: string; name: string }[];
  targetGroups?: { jid: string; name: string }[];
  messageTemplate?: string | null;
  userId?: number | null;
}

// ─── Repository ──────────────────────────────────────────────────────

export class MirrorRepository {
  /**
   * Lista espelhamentos com paginação e filtros.
   *
   * Filtros disponíveis:
   *   status — active | inactive
   *   userId — filtrar por usuário
   *   search — busca textual em name
   *   page / pageSize — paginação (default: page=1, pageSize=25)
   */
  async list(filters: MirrorListFilters = {}): Promise<MirrorListResponse> {
    const db = getDb();
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;

    const conditions: ReturnType<typeof eq>[] = [];

    if (filters.status) {
      conditions.push(eq(mirrors.status, filters.status));
    }
    if (filters.userId) {
      conditions.push(eq(mirrors.userId, filters.userId));
    }
    if (filters.search) {
      conditions.push(like(mirrors.name, `%${filters.search}%`));
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Total de registros (para paginação)
    const [totalResult] = await db
      .select({ total: count() })
      .from(mirrors)
      .where(where);

    const total = Number(totalResult?.total ?? 0);

    // Busca paginada
    const rows = await db
      .select()
      .from(mirrors)
      .where(where)
      .orderBy(desc(mirrors.updatedAt))
      .limit(pageSize)
      .offset(offset);

    return {
      rows,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Busca um espelhamento pelo ID.
   */
  async findById(id: number): Promise<Mirror | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mirrors)
      .where(eq(mirrors.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Cria um novo espelhamento.
   */
  async create(data: NewMirror): Promise<Mirror> {
    const db = getDb();
    const [row] = await db
      .insert(mirrors)
      .values(data)
      .returning();
    return row!;
  }

  /**
   * Atualiza um espelhamento existente (substituição parcial via PATCH semantics).
   * Retorna null se não encontrado.
   */
  async update(id: number, data: MirrorUpdateData): Promise<Mirror | null> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) return null;

    const [row] = await db
      .update(mirrors)
      .set(data)
      .where(eq(mirrors.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Ativa ou desativa um espelhamento.
   * status: 'active' | 'inactive'
   */
  async patchStatus(id: number, status: string): Promise<Mirror | null> {
    const db = getDb();
    const existing = await this.findById(id);
    if (!existing) return null;

    const [row] = await db
      .update(mirrors)
      .set({ status })
      .where(eq(mirrors.id, id))
      .returning();
    return row ?? null;
  }

  /**
   * Exclui um espelhamento pelo ID.
   * Retorna true se foi excluído, false se não encontrado.
   */
  async delete(id: number): Promise<boolean> {
    const db = getDb();
    const result = await db
      .delete(mirrors)
      .where(eq(mirrors.id, id))
      .returning({ id: mirrors.id });
    return result.length > 0;
  }
}
