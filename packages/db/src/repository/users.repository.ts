import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import { getDb } from '../db.ts';
import { users } from '../schema/index.ts';
import { toUserPublic } from './users-pure.ts';
import type { UserPublic } from './users-pure.ts';

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type { UserPublic } from './users-pure.ts';

// ─── Repository ──────────────────────────────────────────────────────

export class UserRepository {
  /**
   * Busca usuário pelo ID.
   */
  async findById(id: number): Promise<User | null> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);

    return rows[0] ?? null;
  }

  /**
   * Busca usuário pelo email.
   */
  async findByEmail(email: string): Promise<User | null> {
    const db = getDb();
    const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);

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
    return user ? toUserPublic(user) : null;
  }

  /**
   * Busca dados públicos pelo email.
   */
  async findPublicByEmail(email: string): Promise<UserPublic | null> {
    const user = await this.findByEmail(email);
    return user ? toUserPublic(user) : null;
  }

  /**
   * Promove um usuário a admin (idempotente).
   * Chamado pelo bootstrap de ADMIN_EMAILS no login/register.
   * Retorna o user atualizado, ou null se não encontrado.
   */
  async promoteToAdmin(email: string): Promise<User | null> {
    const db = getDb();
    const [row] = await db
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.email, email))
      .returning();
    return row ?? null;
  }
}
