import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { amazonAffiliates } from '../schema/index.ts';
import type { AmazonTrackingId } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type AmazonAffiliate = InferSelectModel<typeof amazonAffiliates>;
export type NewAmazonAffiliate = InferInsertModel<typeof amazonAffiliates>;

/**
 * Sumário para listagem (sem campos sensíveis, que aqui não existem
 * — Amazon tracking IDs são públicos).
 */
export interface AmazonAffiliateSummary {
  id: number;
  userId: number;
  nickname: string | null;
  trackingIds: AmazonTrackingId[];
  activeTrackingCount: number;
  active: boolean;
  connectedAt: Date;
  lastUsedAt: Date;
}

/**
 * Dados para criar um afiliado Amazon (PUT /api/amazon/affiliates).
 */
export interface AmazonAffiliateUpsertData {
  nickname?: string | null;
  trackingIds?: AmazonTrackingId[];
  active?: boolean;
}

/**
 * Input para criar/atualizar um único tracking ID.
 */
export interface AmazonTrackingIdInput {
  tag: string;
  label?: string;
  region?: AmazonAffiliate['trackingIds'][number]['region'];
  active?: boolean;
  isDefault?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Detecta a região pelo sufixo do tracking ID.
 * -20 = BR/US/CA/MX (Amazon Associates unifica)
 * -21 = UK/DE/FR/IT/ES/NL/SE/PL/EG/IN/SG/SA/AE/TR
 * -22 = JP/AU
 * outros → 'OTHER'
 */
export function detectRegion(tag: string): AmazonTrackingId['region'] {
  if (!tag) return 'OTHER';
  if (tag.endsWith('-22')) return 'JP'; // primeira heurística, mas JP e AU compartilham
  if (tag.endsWith('-21')) return 'UK';
  if (tag.endsWith('-20')) return 'BR'; // default mais comum no nosso contexto
  return 'OTHER';
}

// ─── Repository ──────────────────────────────────────────────────────

export class AmazonAffiliateRepository {
  /**
   * Busca afiliado pelo ID interno.
   */
  async findById(id: number): Promise<AmazonAffiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(amazonAffiliates)
      .where(eq(amazonAffiliates.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Busca afiliado pelo userId da plataforma.
   * Retorna null se não existir.
   */
  async findByUserId(userId: number): Promise<AmazonAffiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(amazonAffiliates)
      .where(eq(amazonAffiliates.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Lista todos os afiliados (sumário).
   */
  async findAll(): Promise<AmazonAffiliateSummary[]> {
    const db = getDb();
    const rows = await db
      .select()
      .from(amazonAffiliates)
      .orderBy(amazonAffiliates.lastUsedAt);
    return rows.map((r) => this.toSummary(r));
  }

  /**
   * Cria ou atualiza (upsert) um afiliado Amazon.
   * Se já existir, preserva `connectedAt` e `lastUsedAt`.
   */
  async upsert(userId: number, data: AmazonAffiliateUpsertData): Promise<AmazonAffiliate> {
    const db = getDb();
    const existing = await this.findByUserId(userId);

    if (existing) {
      const updateData: Record<string, unknown> = {};
      if (data.nickname !== undefined) updateData.nickname = data.nickname;
      if (data.trackingIds !== undefined) updateData.trackingIds = data.trackingIds;
      if (data.active !== undefined) updateData.active = data.active;

      if (Object.keys(updateData).length === 0) return existing;

      const [row] = await db
        .update(amazonAffiliates)
        .set(updateData)
        .where(eq(amazonAffiliates.userId, userId))
        .returning();
      return row!;
    }

    const [row] = await db
      .insert(amazonAffiliates)
      .values({
        userId,
        nickname: data.nickname ?? null,
        trackingIds: data.trackingIds ?? [],
        active: data.active ?? true,
      })
      .returning();
    return row!;
  }

  /**
   * Adiciona um tracking ID a um afiliado existente.
   * Se for o primeiro, vira `isDefault: true` automaticamente.
   * Se nenhum `isDefault` existir quando adicionar, o novo vira default.
   */
  async addTrackingId(userId: number, input: AmazonTrackingIdInput): Promise<AmazonAffiliate | null> {
    const db = getDb();
    const existing = await this.findByUserId(userId);
    if (!existing) return null;

    const current = existing.trackingIds ?? [];
    if (current.length >= 100) {
      throw new Error('Limite de 100 tracking IDs por afiliado excedido (regra Amazon Associates)');
    }

    const hasAnyDefault = current.some((t) => t.isDefault);
    const newTrackingId: AmazonTrackingId = {
      tag: input.tag,
      label: input.label,
      region: input.region ?? detectRegion(input.tag),
      active: input.active ?? true,
      isDefault: input.isDefault ?? !hasAnyDefault,
      createdAt: new Date().toISOString(),
    };

    const updated = [...current, newTrackingId];
    const [row] = await db
      .update(amazonAffiliates)
      .set({ trackingIds: updated })
      .where(eq(amazonAffiliates.userId, userId))
      .returning();
    return row ?? null;
  }

  /**
   * Remove um tracking ID pelo tag.
   * Se removeu o default, promove o primeiro `active` restante a default.
   */
  async removeTrackingId(userId: number, tag: string): Promise<AmazonAffiliate | null> {
    const db = getDb();
    const existing = await this.findByUserId(userId);
    if (!existing) return null;

    const current = existing.trackingIds ?? [];
    const filtered = current.filter((t) => t.tag !== tag);
    if (filtered.length === current.length) return existing; // tag não existia

    // Se removeu o default, promover o próximo
    const wasDefaultRemoved = current.find((t) => t.tag === tag)?.isDefault ?? false;
    if (wasDefaultRemoved) {
      const firstActive = filtered.find((t) => t.active);
      if (firstActive) {
        firstActive.isDefault = true;
      }
    }

    const [row] = await db
      .update(amazonAffiliates)
      .set({ trackingIds: filtered })
      .where(eq(amazonAffiliates.userId, userId))
      .returning();
    return row ?? null;
  }

  /**
   * Atualiza campos parciais de um tracking ID (label, active, isDefault).
   * Se marcar `isDefault: true` em um, desmarca os outros.
   */
  async updateTrackingId(
    userId: number,
    tag: string,
    patch: Partial<Omit<AmazonTrackingId, 'tag' | 'createdAt'>>,
  ): Promise<AmazonAffiliate | null> {
    const db = getDb();
    const existing = await this.findByUserId(userId);
    if (!existing) return null;

    const current = existing.trackingIds ?? [];
    const idx = current.findIndex((t) => t.tag === tag);
    if (idx === -1) return existing;

    const updated = [...current];
    const currentItem = updated[idx]!;
    const patched: AmazonTrackingId = {
      ...currentItem,
      ...patch,
      // `tag` e `createdAt` são imutáveis
    };

    // Se marcou isDefault, desmarca os outros
    if (patch.isDefault === true) {
      updated.forEach((t, i) => {
        if (i !== idx) t.isDefault = false;
      });
    }

    updated[idx] = patched;

    const [row] = await db
      .update(amazonAffiliates)
      .set({ trackingIds: updated })
      .where(eq(amazonAffiliates.userId, userId))
      .returning();
    return row ?? null;
  }

  /**
   * Retorna o tracking ID default ativo de um afiliado.
   * Usado pelo ingestor / test-conversion quando o mirror não especifica.
   */
  async getDefaultTrackingId(userId: number): Promise<string | null> {
    const affiliate = await this.findByUserId(userId);
    if (!affiliate) return null;
    const defaultItem = affiliate.trackingIds?.find((t) => t.isDefault && t.active);
    return defaultItem?.tag ?? null;
  }

  /**
   * Retorna um tracking ID específico pelo tag (validando que está ativo).
   */
  async getActiveTrackingId(userId: number, tag: string): Promise<string | null> {
    const affiliate = await this.findByUserId(userId);
    if (!affiliate) return null;
    const item = affiliate.trackingIds?.find((t) => t.tag === tag && t.active);
    return item?.tag ?? null;
  }

  /**
   * Atualiza lastUsedAt (touch).
   */
  async touch(userId: number): Promise<void> {
    const db = getDb();
    await db
      .update(amazonAffiliates)
      .set({ lastUsedAt: new Date() })
      .where(eq(amazonAffiliates.userId, userId));
  }

  /**
   * Remove o afiliado (e todos os tracking IDs).
   */
  async delete(userId: number): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .delete(amazonAffiliates)
      .where(eq(amazonAffiliates.userId, userId))
      .returning({ id: amazonAffiliates.id });
    return rows.length > 0;
  }

  // ─── Helpers privados ────────────────────────────────────────────────

  private toSummary(r: AmazonAffiliate): AmazonAffiliateSummary {
    const ids = r.trackingIds ?? [];
    return {
      id: r.id,
      userId: r.userId,
      nickname: r.nickname,
      trackingIds: ids,
      activeTrackingCount: ids.filter((t) => t.active).length,
      active: r.active,
      connectedAt: r.connectedAt,
      lastUsedAt: r.lastUsedAt,
    };
  }
}
