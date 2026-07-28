import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { featureFlags } from '../schema/index.ts';

export type FeatureFlagRow = {
  key: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: Date;
};

export type NewFeatureFlagRow = typeof featureFlags.$inferInsert;

export class FeatureFlagRepository {
  async findAll(): Promise<FeatureFlagRow[]> {
    const db = getDb();
    return db.select().from(featureFlags);
  }

  async findByKey(key: string): Promise<FeatureFlagRow | null> {
    const db = getDb();
    const rows = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return rows[0] ?? null;
  }

  async upsert(key: string, enabled: boolean, updatedBy: string | null): Promise<FeatureFlagRow> {
    const db = getDb();
    const rows = await db
      .insert(featureFlags)
      .values({ key, enabled, updatedBy })
      .onConflictDoUpdate({ target: featureFlags.key, set: { enabled, updatedBy } })
      .returning();
    return rows[0]!;
  }
}
