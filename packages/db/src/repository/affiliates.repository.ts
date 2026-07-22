import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { affiliates } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type Affiliate = InferSelectModel<typeof affiliates>;
export type NewAffiliate = InferInsertModel<typeof affiliates>;

export interface ExcludedGroup {
  groupJid: string;
  groupName: string;
  reason: string;
  ratio: number;
  totalMessages: number;
  validOffers: number;
}

export interface Filters {
  blacklist: string[];
  keywords: string[];
  dedupHours: number;
}

export interface AffiliateGroupConfig {
  sourceGroups: { jid: string; name: string }[];
  targetGroups: { jid: string; name: string }[];
  excludedGroups?: ExcludedGroup[];
  messageTemplate?: string | null;
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
   * Inclui a persistência de grupos excluídos por validação.
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
          excludedGroups: config.excludedGroups ?? [],
          messageTemplate: config.messageTemplate ?? null,
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
        excludedGroups: config.excludedGroups ?? [],
        messageTemplate: config.messageTemplate ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Adiciona um grupo à lista de excluídos (ou atualiza se já existir).
   */
  async addExcludedGroup(
    evolutionInstanceId: string,
    excluded: ExcludedGroup,
  ): Promise<Affiliate | null> {
    const db = getDb();
    const existing = await this.findByEvolutionInstanceId(evolutionInstanceId);
    if (!existing) return null;

    const current = (existing.excludedGroups ?? []) as ExcludedGroup[];
    const idx = current.findIndex((g) => g.groupJid === excluded.groupJid);
    if (idx >= 0) {
      current[idx] = excluded;
    } else {
      current.push(excluded);
    }

    const [row] = await db
      .update(affiliates)
      .set({ excludedGroups: current })
      .where(eq(affiliates.id, existing.id))
      .returning();
    return row ?? null;
  }

  /**
   * Remove um grupo da lista de excluídos pelo JID.
   */
  async removeExcludedGroup(
    evolutionInstanceId: string,
    groupJid: string,
  ): Promise<Affiliate | null> {
    const db = getDb();
    const existing = await this.findByEvolutionInstanceId(evolutionInstanceId);
    if (!existing) return null;

    const current = (existing.excludedGroups ?? []) as ExcludedGroup[];
    const filtered = current.filter((g) => g.groupJid !== groupJid);

    const [row] = await db
      .update(affiliates)
      .set({ excludedGroups: filtered })
      .where(eq(affiliates.id, existing.id))
      .returning();
    return row ?? null;
  }

  /**
   * Atualiza apenas o template de mensagem de um afiliado.
   */
  async updateMessageTemplate(
    evolutionInstanceId: string,
    messageTemplate: string | null,
  ): Promise<Affiliate | null> {
    const db = getDb();
    const existing = await this.findByEvolutionInstanceId(evolutionInstanceId);
    if (!existing) return null;

    const [row] = await db
      .update(affiliates)
      .set({ messageTemplate: messageTemplate ?? null })
      .where(eq(affiliates.id, existing.id))
      .returning();
    return row ?? null;
  }

  /**
   * Atualiza os filtros (blacklist, keywords, dedupHours) de um afiliado.
   */
  async updateFilters(
    evolutionInstanceId: string,
    filters: Filters,
  ): Promise<Affiliate | null> {
    const db = getDb();
    const existing = await this.findByEvolutionInstanceId(evolutionInstanceId);
    if (!existing) return null;

    const [row] = await db
      .update(affiliates)
      .set({ filters })
      .where(eq(affiliates.id, existing.id))
      .returning();
    return row ?? null;
  }

  /**
   * Busca o template de mensagem de um afiliado pelo ID.
   */
  async findMessageTemplateById(
    affiliateId: number,
  ): Promise<string | null | undefined> {
    const db = getDb();
    const rows = await db
      .select({ messageTemplate: affiliates.messageTemplate })
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId))
      .limit(1);

    if (!rows[0]) return undefined;
    return rows[0].messageTemplate;
  }

  /**
   * Busca a configuração completa de template de um afiliado pelo ID.
   */
  async findTemplateConfigById(
    affiliateId: number,
  ): Promise<{ messageTemplate: string | null } | null> {
    const db = getDb();
    const rows = await db
      .select({ messageTemplate: affiliates.messageTemplate })
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId))
      .limit(1);
    return rows[0] ?? null;
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

  /**
   * Lista todos os afiliados ativos que possuem sourceGroups configurados.
   * Usado pelo revalidation worker para percorrer todos os afiliados.
   */
  async findAllActiveWithSourceGroups(): Promise<Affiliate[]> {
    const db = getDb();
    const all = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.active, true));
    
    return all.filter((aff) => {
      const groups = aff.sourceGroups as { jid: string; name: string }[] | null;
      return groups != null && groups.length > 0;
    });
  }

  /**
   * Busca afiliados ativos com sourceGroups que precisam de revalidação.
   *
   * Retorna afiliados que:
   *   - Nunca foram validados (lastValidatedAt IS NULL)
   *   - OU foram validados há mais de N dias atrás
   */
  async findAllNeedingRevalidation(daysInterval: number): Promise<Affiliate[]> {
    const db = getDb();
    const all = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.active, true));
    
    const cutoff = new Date(Date.now() - daysInterval * 24 * 60 * 60 * 1000);
    
    return all.filter((aff) => {
      const groups = aff.sourceGroups as { jid: string; name: string }[] | null;
      if (!groups || groups.length === 0) return false;
      if (!aff.lastValidatedAt) return true;
      return aff.lastValidatedAt < cutoff;
    });
  }

  /**
   * Atualiza os dados de revalidação periódica de um afiliado.
   */
  async updateValidation(
    affiliateId: number,
    validationData: {
      lastValidatedAt: Date;
      lastValidationPassed: boolean;
      lastValidationReport: {
        overallRatio: number;
        totalMessages: number;
        totalValidOffers: number;
        groups: {
          groupJid: string;
          groupName: string;
          totalMessages: number;
          validOffers: number;
          ratio: number;
          passed: boolean;
        }[];
      };
    },
  ): Promise<Affiliate | null> {
    const db = getDb();
    const [row] = await db
      .update(affiliates)
      .set({
        lastValidatedAt: validationData.lastValidatedAt,
        lastValidationPassed: validationData.lastValidationPassed,
        lastValidationReport: validationData.lastValidationReport,
      })
      .where(eq(affiliates.id, affiliateId))
      .returning();
    return row ?? null;
  }
}
