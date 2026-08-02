import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { and, eq, isNull, isNotNull } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { authRefreshTokens } from '../schema/index.ts';

export type AuthRefreshToken = InferSelectModel<typeof authRefreshTokens>;
export type NewAuthRefreshToken = InferInsertModel<typeof authRefreshTokens>;

/**
 * Repository de refresh tokens (schema omestre).
 *
 * Guarda apenas o hash do token, a família de rotação e o estado de revogação.
 * Nunca guarda o valor cru do token.
 */
export class AuthRefreshTokenRepository {
  /**
   * Cria um novo registro de refresh token.
   */
  async create(data: NewAuthRefreshToken): Promise<AuthRefreshToken> {
    const db = getDb();
    const [row] = await db.insert(authRefreshTokens).values(data).returning();
    return row!;
  }

  /**
   * Busca refresh token vivo (não revogado) pelo hash.
   */
  async findActiveByHash(tokenHash: string): Promise<AuthRefreshToken | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(authRefreshTokens)
      .where(and(eq(authRefreshTokens.tokenHash, tokenHash), isNull(authRefreshTokens.revokedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Busca refresh token pelo hash, inclusive revogados (para detectar replay).
   */
  async findByHashIncludingRevoked(tokenHash: string): Promise<AuthRefreshToken | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(authRefreshTokens)
      .where(eq(authRefreshTokens.tokenHash, tokenHash))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Verifica se existe algum token já revogado na família.
   * Se um replay é detectado (reuso de token antigo), a família inteira é revogada.
   */
  async existsRevokedInFamily(familyId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: authRefreshTokens.id })
      .from(authRefreshTokens)
      .where(and(eq(authRefreshTokens.familyId, familyId), isNotNull(authRefreshTokens.revokedAt)))
      .limit(1);

    return rows.length > 0;
  }

  /**
   * Revoga um refresh token pelo id (rotação).
   */
  async revokeById(id: number): Promise<void> {
    const db = getDb();
    await db
      .update(authRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(authRefreshTokens.id, id));
  }

  /**
   * Revoga toda a família (caso de replay/roubo). Retorna nº de linhas afetadas.
   */
  async revokeFamilyByFamilyId(familyId: string): Promise<number> {
    const db = getDb();
    const result = await db
      .update(authRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(authRefreshTokens.familyId, familyId))
      .returning({ id: authRefreshTokens.id });

    return result.length;
  }
}
