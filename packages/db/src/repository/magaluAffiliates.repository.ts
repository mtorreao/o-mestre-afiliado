import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { magaluAffiliates } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type MagaluAffiliate = InferSelectModel<typeof magaluAffiliates>;
export type NewMagaluAffiliate = InferInsertModel<typeof magaluAffiliates>;

/**
 * Sumário para listagem (sem campos sensíveis — Magalu não tem
 * credenciais armazenadas, apenas o slug público da loja).
 */
export interface MagaluAffiliateSummary {
  id: number;
  userId: number;
  nickname: string | null;
  storeSlug: string;
  active: boolean;
  connectedAt: Date;
  lastUsedAt: Date;
}

/**
 * Dados para criar/atualizar um afiliado Magalu.
 * `storeSlug` é obrigatório (NOT NULL no banco — nome da loja no
 * Magazine Você escolhido no cadastro do programa Influenciador Magalu).
 */
export interface MagaluAffiliateUpsertData {
  nickname?: string;
  storeSlug: string;
  active?: boolean;
}

// ─── Repository ──────────────────────────────────────────────────────

export class MagaluAffiliateRepository {
  /**
   * Busca afiliado pelo ID interno.
   */
  async findById(id: number): Promise<MagaluAffiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(magaluAffiliates)
      .where(eq(magaluAffiliates.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Busca afiliado pelo userId da plataforma (1:1 — UNIQUE(user_id)).
   * Retorna null se não existir.
   */
  async findByUserId(userId: number): Promise<MagaluAffiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(magaluAffiliates)
      .where(eq(magaluAffiliates.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Lista todos os afiliados Magalu (sumário).
   */
  async findAll(): Promise<MagaluAffiliateSummary[]> {
    const db = getDb();
    const rows = await db.select().from(magaluAffiliates).orderBy(magaluAffiliates.lastUsedAt);
    return rows.map((r) => this.toSummary(r));
  }

  /**
   * Cria ou atualiza (upsert) um afiliado Magalu.
   * Se já existir (mesmo userId), atualiza os campos fornecidos
   * preservando `connectedAt`, `lastUsedAt`, `createdAt` e `updatedAt`.
   */
  async upsert(userId: number, data: MagaluAffiliateUpsertData): Promise<MagaluAffiliate> {
    const db = getDb();
    const existing = await this.findByUserId(userId);

    if (existing) {
      const updateData: Record<string, unknown> = {};
      if (data.nickname !== undefined) updateData.nickname = data.nickname;
      if (data.storeSlug !== undefined) updateData.storeSlug = data.storeSlug;
      if (data.active !== undefined) updateData.active = data.active;

      if (Object.keys(updateData).length === 0) return existing;

      const [row] = await db
        .update(magaluAffiliates)
        .set(updateData)
        .where(eq(magaluAffiliates.userId, userId))
        .returning();
      return row!;
    }

    const [row] = await db
      .insert(magaluAffiliates)
      .values({
        userId,
        nickname: data.nickname ?? null,
        storeSlug: data.storeSlug,
        active: data.active ?? true,
      })
      .returning();
    return row!;
  }

  /**
   * Atualiza lastUsedAt (touch).
   */
  async touch(userId: number): Promise<void> {
    const db = getDb();
    await db
      .update(magaluAffiliates)
      .set({ lastUsedAt: new Date() })
      .where(eq(magaluAffiliates.userId, userId));
  }

  /**
   * Remove o afiliado Magalu.
   */
  async delete(userId: number): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .delete(magaluAffiliates)
      .where(eq(magaluAffiliates.userId, userId))
      .returning({ id: magaluAffiliates.id });
    return rows.length > 0;
  }

  // ─── Helpers privados ────────────────────────────────────────────────

  private toSummary(r: MagaluAffiliate): MagaluAffiliateSummary {
    return {
      id: r.id,
      userId: r.userId,
      nickname: r.nickname,
      storeSlug: r.storeSlug,
      active: r.active,
      connectedAt: r.connectedAt,
      lastUsedAt: r.lastUsedAt,
    };
  }
}
