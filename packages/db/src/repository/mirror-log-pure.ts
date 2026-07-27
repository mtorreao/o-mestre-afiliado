/**
 * Lógica PURA do repositório de logs de mensagens espelhadas (MirrorLog).
 *
 * Separa a normalização de paginação, a resolução de JIDs de grupos a
 * partir de nomes (busca textual), e a montagem das linhas com os nomes
 * dos grupos (que não dependem de DB) das operações de I/O. Funções
 * síncronas, 100% testáveis sem PostgreSQL.
 */

export const MIRROR_LOG_MAX_PAGE_SIZE = 100;
export const MIRROR_LOG_DEFAULT_PAGE_SIZE = 25;

// Grupo (source/target) persistido como JSONB em `mirrors`.
export interface MirrorGroup {
  jid: string;
  name: string;
}

// Linha crua retornada pela query (sem nomes de grupo).
export interface MirrorLogRawRow {
  id: number;
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string;
  marketplace: string;
  messagePreview: string | null;
  reflectedAt: Date;
  status: string;
  failureReason: string | null;
}

export interface MirrorLogRow extends MirrorLogRawRow {
  sourceGroupName: string | null;
  targetGroupName: string | null;
}

export interface NormalizedMirrorLogPagination {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * Normaliza page/pageSize aplicando limites exatamente como o repo original:
 *  - page: mínimo 1
 *  - pageSize: entre 1 e MIRROR_LOG_MAX_PAGE_SIZE (default MIRROR_LOG_DEFAULT_PAGE_SIZE)
 *  - offset: (page - 1) * pageSize
 */
export function normalizeMirrorLogPagination(
  page: number | undefined,
  pageSize: number | undefined,
): NormalizedMirrorLogPagination {
  const p = Math.max(1, page ?? 1);
  const size = Math.min(
    MIRROR_LOG_MAX_PAGE_SIZE,
    Math.max(1, pageSize ?? MIRROR_LOG_DEFAULT_PAGE_SIZE),
  );
  return {
    page: p,
    pageSize: size,
    offset: (p - 1) * size,
  };
}

/**
 * Calcula o total de páginas tal como o repo original:
 *   Math.ceil(total / pageSize)
 * (sem o piso em 1 — mantém o comportamento original, inclusive total=0 → 0).
 */
export function computeMirrorLogTotalPages(total: number, pageSize: number): number {
  if (pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

/**
 * Dado o conjunto de `mirrors` (com sourceGroups/targetGroups) e um termo de
 * busca já normalizado (minúsculo), retorna os JIDs de grupos cujo nome
 * corresponde ao termo. Função pura usada pela busca textual do `list`.
 *
 * `mirrorRows` é iterável de objetos com `sourceGroups`/`targetGroups`
 * (array de { jid, name } | null).
 */
export function matchGroupJids<
  T extends { sourceGroups?: MirrorGroup[] | null; targetGroups?: MirrorGroup[] | null },
>(
  mirrorRows: Iterable<T>,
  lowerTerm: string,
): { matchingSourceJids: string[]; matchingTargetJids: string[] } {
  const matchingSourceJids: string[] = [];
  const matchingTargetJids: string[] = [];

  for (const m of mirrorRows) {
    const srcGroups = m.sourceGroups;
    if (srcGroups) {
      for (const g of srcGroups) {
        if (g.name.toLowerCase().includes(lowerTerm)) {
          matchingSourceJids.push(g.jid);
        }
      }
    }
    const tgtGroups = m.targetGroups;
    if (tgtGroups) {
      for (const g of tgtGroups) {
        if (g.name.toLowerCase().includes(lowerTerm)) {
          matchingTargetJids.push(g.jid);
        }
      }
    }
  }

  return { matchingSourceJids, matchingTargetJids };
}

/**
 * Constrói o Map de jid → nome de grupo a partir do conjunto de `mirrors`.
 * Útil para preencher sourceGroupName/targetGroupName nas linhas do log.
 */
export function buildGroupNamesMap<
  T extends { sourceGroups?: MirrorGroup[] | null; targetGroups?: MirrorGroup[] | null },
>(mirrorRows: Iterable<T>): Map<string, string> {
  const groupNames = new Map<string, string>();

  for (const m of mirrorRows) {
    const srcGroups = m.sourceGroups;
    if (srcGroups) {
      for (const g of srcGroups) {
        groupNames.set(g.jid, g.name);
      }
    }
    const tgtGroups = m.targetGroups;
    if (tgtGroups) {
      for (const g of tgtGroups) {
        groupNames.set(g.jid, g.name);
      }
    }
  }

  return groupNames;
}

/**
 * Monta as linhas do log (MirrorLogRow) a partir das linhas cruas da query e
 * do Map de jid → nome de grupo. Campos de nome viram `null` quando o JID
 * não está no mapa.
 */
export function buildMirrorLogRows(
  rows: MirrorLogRawRow[],
  groupNames: Map<string, string>,
): MirrorLogRow[] {
  return rows.map((r) => ({
    ...r,
    sourceGroupName: groupNames.get(r.sourceGroupJid) ?? null,
    targetGroupName: groupNames.get(r.targetGroupJid) ?? null,
  }));
}
