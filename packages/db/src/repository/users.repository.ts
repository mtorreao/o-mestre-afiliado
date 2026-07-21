import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { users } from '../schema/index.ts';

// ─── Tipos públicos ──────────────────────────────────────────────────

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;

/**
 * Dados públicos do usuário (sem password_hash).
 */
export interface UserPublic {
  id: number;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Retorna os dados públicos de um User (remove password_hash).
 */
function toPublic(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// ─── Repository ──────────────────────────────────────────────────────

export class UserRepository {
  /**
   * Busca usuário pelo ID.
   */
  async findById(id: number): Promise<User | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Busca usuário pelo email.
   */
  async findByEmail(email: string): Promise<User | null> {
    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Cria um novo usuário.
   */
  async create(data: NewUser): Promise<User> {
    const db = getDb();
    const [row] = await db.insert(users).values(data).returning();
    return row!;
  }

  /**
   * Busca dados públicos pelo ID.
   */
  async findPublicById(id: number): Promise<UserPublic | null> {
    const user = await this.findById(id);
    return user ? toPublic(user) : null;
  }

  /**
   * Busca dados públicos pelo email.
   */
  async findPublicByEmail(email: string): Promise<UserPublic | null> {
    const user = await this.findByEmail(email);
    return user ? toPublic(user) : null;
  }
}
