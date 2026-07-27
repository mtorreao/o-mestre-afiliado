import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { userCredentials } from '../schema/index.ts';
import { buildCredentialsUpdate, buildCredentialsInsert } from './user-credentials-pure.ts';
import type { UserCredentialsInput } from './user-credentials-pure.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type UserCredentials = InferSelectModel<typeof userCredentials>;
export type NewUserCredentials = InferInsertModel<typeof userCredentials>;

export type { UserCredentialsInput } from './user-credentials-pure.ts';

// ─── Repository ──────────────────────────────────────────────────────

export class UserCredentialsRepository {
  /**
   * Busca credenciais pelo userId.
   */
  async findByUserId(userId: number): Promise<UserCredentials | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userCredentials)
      .where(eq(userCredentials.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Cria ou atualiza (upsert) credenciais de um usuário.
   * Como tem UNIQUE(user_id), usa INSERT ON CONFLICT.
   */
  async upsert(userId: number, data: UserCredentialsInput): Promise<UserCredentials> {
    const db = getDb();
    const existing = await this.findByUserId(userId);

    if (existing) {
      const updateData = buildCredentialsUpdate(data);

      if (Object.keys(updateData).length === 0) return existing;

      const [row] = await db
        .update(userCredentials)
        .set(updateData)
        .where(eq(userCredentials.userId, userId))
        .returning();

      return row!;
    }

    const [row] = await db
      .insert(userCredentials)
      .values(buildCredentialsInsert(userId, data))
      .returning();

    return row!;
  }
}
