/**
 * Repositório de sessões do admin-api.
 *
 * Persiste sessões em Postgres (fonte da verdade) + cache no Redis (5 min TTL).
 * Por que Postgres: sobrevive a restart do admin-api e do Redis. O cache serve
 * apenas para evitar 1 query por request no caminho quente.
 *
 * Tabela: `omestre_admin.session` (vide schema.ts).
 *
 * Não mockar nada: este repositório é a única porta de entrada para I/O de
 * sessão, então testes injetam um fake via `deps.sessionRepo`.
 */
import { and, eq, gt, lt } from 'drizzle-orm';
import { createAdminDb, readAdminDbConfig, type AdminDb } from './db.ts';
import { session as sessionTable, type Session } from './schema.ts';

export interface CreateSessionInput {
  id: string;
  email: string;
  csrfToken: string;
  encryptedPayload: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: Date;
}

export type SessionRecord = Session;

export class SessionRepository {
  private readonly db: AdminDb | null;
  private _conn: AdminDb | null | undefined = undefined;

  constructor(db?: AdminDb) {
    this.db = db ?? null;
  }

  /** Conexão lazy — só lê env vars no primeiro uso. Retorna null se
   * faltar env obrigatória (fail-open: o caller trata como sessão
   * inválida em vez de crashar o processo). */
  private get conn(): AdminDb | null {
    if (this.db) return this.db;
    if (this._conn !== undefined) return this._conn;
    try {
      this._conn = createAdminDb(readAdminDbConfig());
    } catch {
      this._conn = null;
    }
    return this._conn;
  }

  /** Insere sessão. `id` é o token (32 bytes hex = 64 chars). */
  async create(input: CreateSessionInput): Promise<SessionRecord> {
    const conn = this.conn;
    if (!conn) throw new Error('admin-db: conexão indisponível (env vars ausentes)');
    const rows = await conn
      .insert(sessionTable)
      .values({
        id: input.id,
        email: input.email,
        csrfToken: input.csrfToken,
        encryptedPayload: input.encryptedPayload,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        expiresAt: input.expiresAt,
      })
      .returning();
    return rows[0]!;
  }

  /** Busca sessão por id (token), retornando null se não existe, expirou, ou DB indisponível. */
  async findValidById(id: string, now: Date = new Date()): Promise<SessionRecord | null> {
    const conn = this.conn;
    if (!conn) return null; // fail-open: token não é válido se não tem como verificar
    const rows = await conn
      .select()
      .from(sessionTable)
      .where(and(eq(sessionTable.id, id), gt(sessionTable.expiresAt, now)))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Atualiza `last_seen_at` (best-effort, sem await se der erro). */
  async touch(id: string, now: Date = new Date()): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    await conn.update(sessionTable).set({ lastSeenAt: now }).where(eq(sessionTable.id, id));
  }

  /** Remove sessão por id. Idempotente — não falha se não existir. */
  async deleteById(id: string): Promise<void> {
    const conn = this.conn;
    if (!conn) return;
    await conn.delete(sessionTable).where(eq(sessionTable.id, id));
  }

  /** Remove todas as sessões expiradas. Retorna número de linhas removidas. */
  async deleteExpired(now: Date = new Date()): Promise<number> {
    const conn = this.conn;
    if (!conn) return 0;
    const result = await conn
      .delete(sessionTable)
      .where(lt(sessionTable.expiresAt, now))
      .returning({ id: sessionTable.id });
    return result.length;
  }
}
