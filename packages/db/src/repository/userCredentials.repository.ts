import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { userCredentials } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type UserCredentials = InferSelectModel<typeof userCredentials>;
export type NewUserCredentials = InferInsertModel<typeof userCredentials>;

/**
 * Dados para criar ou atualizar credenciais.
 * Campos undefined = não alterar.
 */
export interface UserCredentialsInput {
  shopeeAppId?: string | null;
  shopeeAppSecret?: string | null;
}

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
      const updateData: Record<string, unknown> = {};
      if (data.shopeeAppId !== undefined) updateData.shopeeAppId = data.shopeeAppId;
      if (data.shopeeAppSecret !== undefined) updateData.shopeeAppSecret = data.shopeeAppSecret;

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
      .values({
        userId,
        shopeeAppId: data.shopeeAppId ?? null,
        shopeeAppSecret: data.shopeeAppSecret ?? null,
      })
      .returning();

    return row!;
  }
}
