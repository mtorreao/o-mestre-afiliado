import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { mlAffiliates } from '../schema/index.ts';
import { encrypt, decrypt } from '../crypto.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type MlAffiliate = InferSelectModel<typeof mlAffiliates>;
export type NewMlAffiliate = InferInsertModel<typeof mlAffiliates>;

/**
 * Resultado parcial para listagem (sem dados sensíveis).
 */
export interface MlAffiliateSummary {
  mlUserId: string;
  nickname: string;
  connectedAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  expired: boolean;
  meliid: string | null;
  melitat: string | null;
  hasSessionCookies: boolean;
}

/**
 * Dados para upsert de afiliado ML (OAuth callback).
 */
export interface MlAffiliateUpsertData {
  mlUserId: string;
  nickname: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;   // segundos (vem do OAuth)
  connectedAt?: Date;
  userId?: number | null;
  meliid?: string | null;
  melitat?: string | null;
  sessionCookies?: string | null;
}

/**
 * Dados para atualização parcial (PUT).
 */
export interface MlAffiliatePatchData {
  meliid?: string;
  melitat?: string;
  sessionCookies?: string;
}

// ─── Repository ──────────────────────────────────────────────────────

export class MlAffiliateRepository {
  /**
   * Lista todos os afiliados (sumário, sem tokens).
   */
  async findAll(): Promise<MlAffiliateSummary[]> {
    const db = getDb();
    const rows = await db.select().from(mlAffiliates).orderBy(mlAffiliates.lastUsedAt);
    const now = new Date();
    return rows.map((r) => ({
      mlUserId: r.mlUserId,
      nickname: r.nickname,
      connectedAt: r.connectedAt,
      lastUsedAt: r.lastUsedAt,
      expiresAt: r.expiresAt,
      expired: r.expiresAt < now,
      meliid: r.meliid,
      melitat: r.melitat,
      hasSessionCookies: !!r.sessionCookies,
    }));
  }

  /**
   * Busca um afiliado pelo mlUserId.
   * Descriptografa sessionCookies automaticamente.
   */
  async findByUserId(mlUserId: string): Promise<MlAffiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mlAffiliates)
      .where(eq(mlAffiliates.mlUserId, mlUserId))
      .limit(1);

    const row = rows[0] ?? null;
    if (row && row.sessionCookies) {
      row.sessionCookies = decrypt(row.sessionCookies);
    }
    return row;
  }

  /**
   * Busca um afiliado ML pelo platform userId (nossa tabela users).
   * Descriptografa sessionCookies automaticamente.
   */
  async findByPlatformUserId(userId: number): Promise<MlAffiliate | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(mlAffiliates)
      .where(eq(mlAffiliates.userId, userId))
      .limit(1);

    const row = rows[0] ?? null;
    if (row && row.sessionCookies) {
      row.sessionCookies = decrypt(row.sessionCookies);
    }
    return row;
  }

  /**
   * Cria ou atualiza um afiliado (usado no callback OAuth).
   *
   * Se já existir, preserva meliid/melitat/sessionCookies existentes
   * e atualiza tokens + lastUsedAt.
   * sessionCookies é criptografado antes de salvar.
   */
  async upsert(data: MlAffiliateUpsertData): Promise<MlAffiliate> {
    const db = getDb();
    const existing = await this.findByUserId(data.mlUserId);
    const now = new Date();
    const expiresAt = new Date(Date.now() + data.expiresIn * 1000);

    if (existing) {
      const updateData: Record<string, unknown> = {
        nickname: data.nickname,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt,
        lastUsedAt: now,
      };
      if (data.userId !== undefined) updateData.userId = data.userId;

      const [row] = await db
        .update(mlAffiliates)
        .set(updateData)
        .where(eq(mlAffiliates.mlUserId, data.mlUserId))
        .returning();

      return row!;
    }

    const [row] = await db
      .insert(mlAffiliates)
      .values({
        mlUserId: data.mlUserId,
        nickname: data.nickname,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        expiresAt,
        connectedAt: data.connectedAt ?? now,
        lastUsedAt: now,
        userId: data.userId ?? null,
        meliid: data.meliid ?? null,
        melitat: data.melitat ?? null,
        sessionCookies: encrypt(data.sessionCookies),
      })
      .returning();

    // Descriptografa sessionCookies antes de retornar (transparente)
    if (row.sessionCookies) {
      row.sessionCookies = decrypt(row.sessionCookies);
    }
    return row!;
  }

  /**
   * Atualiza campos parciais do afiliado (usado no PUT /api/ml/affiliates/:mlUserId).
   * sessionCookies é criptografado antes de salvar.
   */
  async patch(mlUserId: string, data: MlAffiliatePatchData): Promise<MlAffiliate | null> {
    const db = getDb();
    const existing = await this.findByUserId(mlUserId);
    if (!existing) return null;

    const updateData: Record<string, unknown> = {};
    if (data.meliid !== undefined) updateData.meliid = data.meliid;
    if (data.melitat !== undefined) updateData.melitat = data.melitat;
    if (data.sessionCookies !== undefined) updateData.sessionCookies = encrypt(data.sessionCookies);

    if (Object.keys(updateData).length === 0) return existing;

    const [row] = await db
      .update(mlAffiliates)
      .set(updateData)
      .where(eq(mlAffiliates.mlUserId, mlUserId))
      .returning();

    // Descriptografa sessionCookies antes de retornar (transparente)
    if (row!.sessionCookies) {
      row!.sessionCookies = decrypt(row!.sessionCookies);
    }
    return row!;
  }

  /**
   * Atualiza tokens OAuth (usado no refresh).
   */
  async refreshTokens(
    mlUserId: string,
    accessToken: string,
    refreshToken: string,
    expiresIn: number,
  ): Promise<MlAffiliate | null> {
    const db = getDb();
    const [row] = await db
      .update(mlAffiliates)
      .set({
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
        lastUsedAt: new Date(),
      })
      .where(eq(mlAffiliates.mlUserId, mlUserId))
      .returning();

    return row ?? null;
  }

  /**
   * Atualiza lastUsedAt (usado após conversão).
   */
  async touch(mlUserId: string): Promise<void> {
    const db = getDb();
    await db
      .update(mlAffiliates)
      .set({ lastUsedAt: new Date() })
      .where(eq(mlAffiliates.mlUserId, mlUserId));
  }

  /**
   * Remove um afiliado pelo mlUserId.
   * Retorna true se removeu, false se não existia.
   */
  async delete(mlUserId: string): Promise<boolean> {
    const db = getDb();
    const [row] = await db
      .delete(mlAffiliates)
      .where(eq(mlAffiliates.mlUserId, mlUserId))
      .returning({ id: mlAffiliates.id });

    return !!row;
  }
}
