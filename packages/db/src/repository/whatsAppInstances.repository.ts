import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq, and } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { userWhatsAppInstances } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type WhatsAppInstance = InferSelectModel<typeof userWhatsAppInstances>;
export type NewWhatsAppInstance = InferInsertModel<typeof userWhatsAppInstances>;

/**
 * Dados públicos da instância (sem apiKey).
 */
export interface WhatsAppInstancePublic {
  id: number;
  userId: number;
  instanceId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Converte para dados públicos (remove apiKey).
 */
function toPublic(row: WhatsAppInstance): WhatsAppInstancePublic {
  return {
    id: row.id,
    userId: row.userId,
    instanceId: row.instanceId,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ─── Repository ──────────────────────────────────────────────────────

export class WhatsAppInstanceRepository {
  /**
   * Busca instância pelo ID interno.
   */
  async findById(id: number): Promise<WhatsAppInstance | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userWhatsAppInstances)
      .where(eq(userWhatsAppInstances.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Busca instância pelo instanceId (Evolution API).
   */
  async findByInstanceId(instanceId: string): Promise<WhatsAppInstance | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userWhatsAppInstances)
      .where(eq(userWhatsAppInstances.instanceId, instanceId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Busca a instância WhatsApp de um usuário.
   * Assume 1 instância por usuário (pode ser expandido para múltiplas).
   */
  async findByUserId(userId: number): Promise<WhatsAppInstance | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(userWhatsAppInstances)
      .where(eq(userWhatsAppInstances.userId, userId))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Cria uma nova instância.
   */
  async create(data: NewWhatsAppInstance): Promise<WhatsAppInstance> {
    const db = getDb();
    const [row] = await db.insert(userWhatsAppInstances).values(data).returning();
    return row!;
  }

  /**
   * Atualiza o status de uma instância.
   */
  async updateStatus(id: number, status: string): Promise<WhatsAppInstance | null> {
    const db = getDb();
    const [row] = await db
      .update(userWhatsAppInstances)
      .set({ status })
      .where(eq(userWhatsAppInstances.id, id))
      .returning();

    return row ?? null;
  }

  /**
   * Remove uma instância pelo instanceId.
   */
  async deleteByInstanceId(instanceId: string): Promise<boolean> {
    const db = getDb();
    const [row] = await db
      .delete(userWhatsAppInstances)
      .where(eq(userWhatsAppInstances.instanceId, instanceId))
      .returning({ id: userWhatsAppInstances.id });

    return !!row;
  }

  /**
   * Remove uma instância pelo userId.
   */
  async deleteByUserId(userId: number): Promise<boolean> {
    const db = getDb();
    const [row] = await db
      .delete(userWhatsAppInstances)
      .where(eq(userWhatsAppInstances.userId, userId))
      .returning({ id: userWhatsAppInstances.id });

    return !!row;
  }
}
