import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { affiliates } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type Affiliate = InferSelectModel<typeof affiliates>;
export type NewAffiliate = InferInsertModel<typeof affiliates>;

export interface NotificationConfig {
  channel: string;
  jid: string | null;
}

// ─── Repository ──────────────────────────────────────────────────────

export class AffiliatesRepository {
  async findById(id: number): Promise<Affiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByEvolutionInstanceId(instanceId: string): Promise<Affiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(affiliates)
      .where(eq(affiliates.evolutionInstanceId, instanceId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findNotificationConfig(
    evolutionInstanceId: string,
  ): Promise<NotificationConfig | null> {
    try {
      const db = getDb();
      const rows = await db
        .select({
          notificationChannel: affiliates.notificationChannel,
          notificationJid: affiliates.notificationJid,
        })
        .from(affiliates)
        .where(eq(affiliates.evolutionInstanceId, evolutionInstanceId))
        .limit(1);

      if (!rows[0]) return null;
      return {
        channel: rows[0].notificationChannel,
        jid: rows[0].notificationJid,
      };
    } catch {
      return null;
    }
  }

  async updateNotificationConfig(
    evolutionInstanceId: string,
    config: { channel: string; jid?: string | null },
  ): Promise<boolean> {
    try {
      const db = getDb();
      const existing = await this.findByEvolutionInstanceId(evolutionInstanceId);
      if (!existing) return false;

      await db
        .update(affiliates)
        .set({
          notificationChannel: config.channel,
          notificationJid: config.jid ?? null,
        })
        .where(eq(affiliates.id, existing.id));

      return true;
    } catch {
      return false;
    }
  }

  async deleteByEvolutionInstanceId(evolutionInstanceId: string): Promise<Affiliate | null> {
    const db = getDb();
    const existing = await this.findByEvolutionInstanceId(evolutionInstanceId);
    if (!existing) return null;

    const [row] = await db
      .delete(affiliates)
      .where(eq(affiliates.id, existing.id))
      .returning();
    return row ?? null;
  }

  async findAll(): Promise<Affiliate[]> {
    const db = getDb();
    return db.select().from(affiliates);
  }
}
