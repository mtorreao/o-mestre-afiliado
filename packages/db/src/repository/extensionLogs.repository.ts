/**
 * ExtensionLogRepository — Inserção em batch de logs da extensão.
 *
 * Sem leitura por enquanto (POST-only). Listas virão em endpoint separado.
 */
import type { ExtensionLogEntry } from '@omestre/shared';
import { getDb } from '../db.ts';
import { extensionLogs } from '../schema/index.ts';

/** Tipo da linha inserida — inferido do schema Drizzle. */
export type InsertedLogRow = {
  id: number;
  sessionId: string;
  userEmail: string | null;
  level: string;
  event: string;
  data: unknown;
  extensionVersion: string;
  chromeVersion: string | null;
  userAgent: string | null;
  receivedAt: Date;
};

export class ExtensionLogRepository {
  /**
   * Insere um batch de entries validadas.
   * Retorna os IDs gerados (mesma ordem do input).
   */
  async insertBatch(entries: ExtensionLogEntry[]): Promise<number[]> {
    if (entries.length === 0) return [];
    const db = getDb();
    const rows = await db
      .insert(extensionLogs)
      .values(
        entries.map((e) => ({
          sessionId: e.sessionId,
          userEmail: e.userEmail,
          level: e.level,
          event: e.event,
          data: e.data ?? null,
          extensionVersion: e.extensionVersion,
          chromeVersion: e.chromeVersion,
          userAgent: e.userAgent,
        })),
      )
      .returning({ id: extensionLogs.id });

    // Garante mesma ordem do input (Drizzle .returning preserva ordem)
    return rows.map((r) => r.id);
  }
}
