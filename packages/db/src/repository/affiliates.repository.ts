import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { affiliates } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type Affiliate = InferSelectModel<typeof affiliates>;
export type NewAffiliate = InferInsertModel<typeof affiliates>;

export interface AffiliateGroupConfig {
  sourceGroups: { jid: string; name: string }[];
  targetGroups: { jid: string; name: string }[];
}

// ─── Repository ──────────────────────────────────────────────────────

export class AffiliatesRepository {
  /**
   * Busca um afiliado pelo ID.
   */
  async findById(id: number): Promise<Affiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Busca um afiliado pelo evolutionInstanceId.
   */
  async findByEvolutionInstanceId(instanceId: string): Promise<Affiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.evolutionInstanceId, instanceId))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Cria ou atualiza a configuração de grupos de um afiliado.
   * Se não existir, cria novo registro com o instanceId.
   */
  async upsertGroups(
    evolutionInstanceId: string,
    config: AffiliateGroupConfig,
  ): Promise<Affiliate> {
    const db = getDb();
    const existing = await this.findByEvolutionInstanceId(evolutionInstanceId);

    if (existing) {
      const [row] = await db
        .update(affiliates)
        .set({
          sourceGroups: config.sourceGroups,
          targetGroups: config.targetGroups,
        })
        .where(eq(affiliates.id, existing.id))
        .returning();
      return row!;
    }

    const [row] = await db
      .insert(affiliates)
      .values({
        name: `Affiliate ${evolutionInstanceId}`,
        active: true,
        evolutionInstanceId,
        sourceGroups: config.sourceGroups,
        targetGroups: config.targetGroups,
      })
      .returning();
    return row!;
  }

  /**
   * Lista todos os afiliados.
   */
  async findAll(): Promise<Affiliate[]> {
    const db = getDb();
    return db.select().from(affiliates);
  }

  /**
   * Busca um afiliado cujo sourceGroups contenha o JID informado.
   *
   * Percorre a lista de sourceGroups (JSONB) e verifica se algum
   * registro tem o JID correspondente. Usa filtro no lado TypeScript
   * porque o PostgreSQL JSONB não suporta busca direta em arrays de
   * objetos aninhados com Drizzle de forma eficiente, e a quantidade
   * de afiliados é pequena (centenas, não milhões).
   */
  async findBySourceGroupJid(jid: string): Promise<Affiliate | null> {
    const db = getDb();
    const all = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.active, true));
    
    for (const aff of all) {
      const groups = aff.sourceGroups as { jid: string; name: string }[] | null;
      if (groups?.some((g) => g.jid === jid)) {
        return aff;
      }
    }
    return null;
  }

  /**
   * Busca um afiliado cujo targetGroups contenha o JID informado.
   */
  async findByTargetGroupJid(jid: string): Promise<Affiliate | null> {
    const db = getDb();
    const all = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.active, true));
    
    for (const aff of all) {
      const groups = aff.targetGroups as { jid: string; name: string }[] | null;
      if (groups?.some((g) => g.jid === jid)) {
        return aff;
      }
    }
    return null;
  }
}
