import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { featureFlags } from '../schema/index.ts';

export type FeatureFlagRow = InferSelectModel<typeof featureFlags>;
export type NewFeatureFlagRow = InferInsertModel<typeof featureFlags>;

/**
 * Repository de feature flags (tabela omestre.feature_flags).
 * Fonte da verdade do estado das flags; o package @omestre/feature-flags
 * consome isto e aplica cache em memória + métrica em Redis.
 */
export class FeatureFlagRepository {
  /** Retorna todas as flags persistidas. */
  async findAll(): Promise<FeatureFlagRow[]> {
    const db = getDb();
    return db.select().from(featureFlags);
  }

  /** Upsert do estado de uma flag (INSERT ou UPDATE por key). */
  async upsert(key: string, enabled: boolean, updatedBy?: string): Promise<FeatureFlagRow> {
    const db = getDb();
    const [row] = await db
      .insert(featureFlags)
      .values({ key, enabled, updatedBy })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: { enabled, updatedBy, updatedAt: new Date() },
      })
      .returning();
    return row!;
  }

  /** Busca uma flag específica (ou null). */
  async findByKey(key: string): Promise<FeatureFlagRow | null> {
    const db = getDb();
    const rows = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return rows[0] ?? null;
  }
}
