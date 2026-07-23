/**
 * MirrorLogRepository — Consultas para os logs de mensagens espelhadas.
 *
 * Fornece paginação, filtros e busca textual na tabela reflected_offers.
 */
import type { InferSelectModel } from 'drizzle-orm';
import { and, eq, gte, lte, ilike, or, sql, desc, count } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { reflectedOffers, affiliates } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type ReflectedOffer = InferSelectModel<typeof reflectedOffers>;

export interface MirrorLogFilters {
  sourceGroupJid?: string;
  targetGroupJid?: string;
  status?: 'sent' | 'failed' | 'blocked';
  marketplace?: 'shopee' | 'mercadolivre' | 'amazon' | 'unknown';
  dateFrom?: string; // ISO string
  dateTo?: string;   // ISO string
  search?: string;   // busca textual em originalLink, convertedLink, messagePreview
  page?: number;
  pageSize?: number;
}

export interface MirrorLogRow {
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
  reflectedAt: Date;
  status: string;
  failureReason: string | null;
}

export interface MirrorLogResponse {
  rows: MirrorLogRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Repository ──────────────────────────────────────────────────────

export class MirrorLogRepository {
  /**
   * Lista logs de mensagens espelhadas com paginação, filtros e busca textual.
   *
   * Filtros disponíveis:
   *   sourceGroupJid — JID do grupo de origem
   *   targetGroupJid — JID do grupo de destino
   *   status — sent | failed | blocked
   *   marketplace — shopee | mercadolivre | amazon | unknown
   *   dateFrom / dateTo — ISO strings para filtrar por reflectedAt
   *   search — busca textual em originalLink, convertedLink, messagePreview
   *   page / pageSize — paginação (default: page=1, pageSize=25)
   */
  async list(filters: MirrorLogFilters): Promise<MirrorLogResponse> {
    const db = getDb();
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 25));
    const offset = (page - 1) * pageSize;

    // Monta condições de filtro
    const conditions: ReturnType<typeof eq>[] = [];

    if (filters.sourceGroupJid) {
      conditions.push(eq(reflectedOffers.sourceGroupJid, filters.sourceGroupJid));
    }
    if (filters.targetGroupJid) {
      conditions.push(eq(reflectedOffers.targetGroupJid, filters.targetGroupJid));
    }
    if (filters.status) {
      conditions.push(eq(reflectedOffers.status, filters.status));
    }
    if (filters.marketplace) {
      conditions.push(eq(reflectedOffers.marketplace, filters.marketplace));
    }
    if (filters.dateFrom) {
      conditions.push(gte(reflectedOffers.reflectedAt, new Date(filters.dateFrom)));
    }
    if (filters.dateTo) {
      conditions.push(lte(reflectedOffers.reflectedAt, new Date(filters.dateTo)));
    }
    if (filters.search) {
      const term = `%${filters.search}%`;
      conditions.push(
        or(
          ilike(reflectedOffers.originalLink, term),
          ilike(reflectedOffers.convertedLink, term),
          ilike(reflectedOffers.messagePreview, term),
        )!,
      );
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    // Total de registros (para paginação)
    const [totalResult] = await db
      .select({ total: count() })
      .from(reflectedOffers)
      .where(where);

    const total = Number(totalResult?.total ?? 0);

    // Busca paginada com JOIN para buscar nomes dos grupos
    const rows = await db
      .select({
        id: reflectedOffers.id,
        affiliateId: reflectedOffers.affiliateId,
        sourceGroupJid: reflectedOffers.sourceGroupJid,
        targetGroupJid: reflectedOffers.targetGroupJid,
        originalLink: reflectedOffers.originalLink,
        convertedLink: reflectedOffers.convertedLink,
        marketplace: reflectedOffers.marketplace,
        messagePreview: reflectedOffers.messagePreview,
        reflectedAt: reflectedOffers.reflectedAt,
        status: reflectedOffers.status,
        failureReason: reflectedOffers.failureReason,
      })
      .from(reflectedOffers)
      .where(where)
      .orderBy(desc(reflectedOffers.reflectedAt))
      .limit(pageSize)
      .offset(offset);

    // Busca nomes dos grupos a partir do JSONB affiliates.sourceGroups e targetGroups
    // Como os JIDs estão em campos separados, precisamos buscar o affiliate e extrair os nomes
    const affiliateIds = [...new Set(rows.map((r) => r.affiliateId))];
    const sourceJids = [...new Set(rows.map((r) => r.sourceGroupJid))];
    const targetJids = [...new Set(rows.map((r) => r.targetGroupJid))];

    // Busca todos os affiliates relevantes para obter os nomes dos grupos
    const affiliatesRows = affiliateIds.length > 0
      ? await db
          .select({
            id: affiliates.id,
            sourceGroups: affiliates.sourceGroups,
            targetGroups: affiliates.targetGroups,
          })
          .from(affiliates)
          .where(
            sql`${affiliates.id} IN (${sql.join(affiliateIds, sql`, `)})`,
          )
      : [];

    // Cria mapas JID → nome a partir dos JSONB dos affiliates
    const sourceGroupNames = new Map<string, string>();
    const targetGroupNames = new Map<string, string>();

    for (const aff of affiliatesRows) {
      const srcGroups = aff.sourceGroups as { jid: string; name: string }[] | null;
      if (srcGroups) {
        for (const g of srcGroups) {
          sourceGroupNames.set(g.jid, g.name);
        }
      }
      const tgtGroups = aff.targetGroups as { jid: string; name: string }[] | null;
      if (tgtGroups) {
        for (const g of tgtGroups) {
          targetGroupNames.set(g.jid, g.name);
        }
      }
    }

    // Monta resultado com nomes dos grupos
    const result: MirrorLogRow[] = rows.map((r) => ({
      ...r,
      sourceGroupName: sourceGroupNames.get(r.sourceGroupJid) ?? null,
      targetGroupName: targetGroupNames.get(r.targetGroupJid) ?? null,
    }));

    return {
      rows: result,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * Lista JIDs de grupos de origem disponíveis nos logs (para filtros).
   */
  async listSourceGroupJids(): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ jid: reflectedOffers.sourceGroupJid })
      .from(reflectedOffers)
      .groupBy(reflectedOffers.sourceGroupJid);
    return rows.map((r) => r.jid);
  }

  /**
   * Lista JIDs de grupos de destino disponíveis nos logs (para filtros).
   */
  async listTargetGroupJids(): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ jid: reflectedOffers.targetGroupJid })
      .from(reflectedOffers)
      .groupBy(reflectedOffers.targetGroupJid);
    return rows.map((r) => r.jid);
  }

  /**
   * Lista marketplaces distintos nos logs.
   */
  async listMarketplaces(): Promise<string[]> {
    const db = getDb();
    const rows = await db
      .select({ marketplace: reflectedOffers.marketplace })
      .from(reflectedOffers)
      .groupBy(reflectedOffers.marketplace);
    return rows.map((r) => r.marketplace);
  }
}
