/**
 * Migration runner — executa ADMIN_MIGRATIONS[] no schema `omestre_admin`.
 *
 * Idempotente: todas as migrations usam `IF NOT EXISTS` / `DO $$`.
 * Pode rodar no startup do admin-api em toda inicialização.
 */
import type { AdminDb } from './db.ts';
import { ADMIN_MIGRATIONS } from './migrations.ts';

export async function migrateAdminDb(db: AdminDb): Promise<void> {
  for (const sql of ADMIN_MIGRATIONS) {
    await db.execute(sql);
  }
}
