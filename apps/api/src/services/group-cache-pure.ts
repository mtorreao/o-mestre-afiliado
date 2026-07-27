/**
 * Lógica PURA do cache de sourceGroups (group-cache).
 *
 * Separa construção de chaves, parsing de valores cacheados, montagem
 * de SourceGroupConfig a partir de rows do mirror e o diff/dedup de
 * grupos da camada de I/O (Redis/PostgreSQL). Todas as funções aqui
 * são síncronas e 100% testáveis sem conexão real.
 */
import type { SourceGroupConfig } from '@omestre/shared';

export const CACHE_PREFIX = 'mirror:source-group:';
export const CACHE_SET_KEY = 'mirror:source-groups:all';

/** TTL padrão de 1 hora (3600s) para cada entrada no cache. */
export const CACHE_TTL = 3600;

/** Monta a chave Redis de um sourceGroup. */
export function sourceGroupCacheKey(groupJid: string): string {
  return `${CACHE_PREFIX}${groupJid}`;
}

/**
 * Parse do valor cacheado no Redis.
 * Suporta formato novo (array de SourceGroupConfig) e legado (objeto único).
 * Retorna null se o JSON for inválido ou o valor vazio.
 */
export function parseCachedSourceGroupConfigs(raw: string | null): SourceGroupConfig[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as SourceGroupConfig[];
    }
    if (parsed && typeof parsed === 'object') {
      // Formato antigo: objeto único → converte para array
      return [parsed as SourceGroupConfig];
    }
    return null;
  } catch {
    return null;
  }
}

/** Shape mínimo de um mirror row usado para montar o SourceGroupConfig. */
export interface MirrorLike {
  id: number;
  userId: number | null;
  sourceGroups?: unknown;
  targetGroups: unknown;
  messageTemplate: unknown;
  subRateLimitMaxMsgs: number | null;
  subRateLimitWindowSec: number | null;
}

/** Nome da instância derivado do userId do mirror. */
export function instanceNameFromMirror(mirror: Pick<MirrorLike, 'userId'>): string {
  return `user-${mirror.userId}`;
}

/** Extrai o primeiro targetGroup do mirror (null se ausente/vazio). */
export function firstTargetGroup(mirror: Pick<MirrorLike, 'targetGroups'>): {
  jid: string;
  name: string;
} | null {
  const targetGroups = mirror.targetGroups as { jid: string; name: string }[] | null;
  return targetGroups?.[0] ?? null;
}

/**
 * Monta o SourceGroupConfig a partir de um mirror + affiliateId.
 * Retorna null se o mirror não tiver targetGroup (config inválida).
 */
export function buildSourceGroupConfig(
  mirror: MirrorLike,
  affiliateId: number,
): SourceGroupConfig | null {
  const targetGroup = firstTargetGroup(mirror);
  if (!targetGroup) return null;

  return {
    affiliateId,
    mirrorId: mirror.id,
    instanceName: instanceNameFromMirror(mirror),
    targetGroupJid: targetGroup.jid,
    targetGroupName: targetGroup.name,
    messageTemplate: mirror.messageTemplate as string | null,
    subRateMaxMsgs: mirror.subRateLimitMaxMsgs ?? 0,
    subRateWindowSec: mirror.subRateLimitWindowSec ?? 300,
  };
}

/** Verifica se um mirror contém o groupJid nos seus sourceGroups. */
export function mirrorHasSourceGroup(
  mirror: Pick<MirrorLike, 'sourceGroups'>,
  groupJid: string,
): boolean {
  const groups = mirror.sourceGroups as { jid: string; name: string }[] | null;
  return Boolean(groups?.some((g) => g.jid === groupJid));
}

/**
 * Diff entre grupos antigos e novos: retorna os JIDs que existiam
 * mas não estão mais na nova configuração (devem sair do cache).
 */
export function diffRemovedGroups(
  oldGroups: { jid: string; name?: string }[],
  newGroups: { jid: string; name?: string }[],
): string[] {
  const newJids = new Set(newGroups.map((g) => g.jid));
  const oldJids = new Set(oldGroups.map((g) => g.jid));
  return [...oldJids].filter((jid) => !newJids.has(jid));
}

/**
 * Agrupa configs por sourceGroupJid com dedup por mirrorId
 * (mesmo (jid, mirrorId) aparece no máximo 1x — último write vence).
 * Usado no warm-up do cache.
 */
export function groupConfigsByJid(
  entries: { jid: string; config: SourceGroupConfig }[],
): Map<string, SourceGroupConfig[]> {
  const grouped = new Map<string, Map<number, SourceGroupConfig>>();

  for (const { jid, config } of entries) {
    let perJid = grouped.get(jid);
    if (!perJid) {
      perJid = new Map<number, SourceGroupConfig>();
      grouped.set(jid, perJid);
    }
    perJid.set(config.mirrorId, config);
  }

  const result = new Map<string, SourceGroupConfig[]>();
  for (const [jid, perMirror] of grouped.entries()) {
    result.set(jid, [...perMirror.values()]);
  }
  return result;
}

// ─── Helpers de leitura de listas (puro) ─────────────────────────────

/**
 * Retorna o affiliateId da PRIMEIRA config da lista (1:N).
 * Usado por `getAffiliateIdBySourceGroup`. Puro.
 */
export function firstAffiliateId(configs: SourceGroupConfig[]): number | null {
  return configs.length > 0 ? configs[0]!.affiliateId : null;
}

/**
 * Retorna a PRIMEIRA SourceGroupConfig da lista (1:N).
 * Usado por `getSourceGroupInfo`. Puro.
 */
export function firstConfig(configs: SourceGroupConfig[]): SourceGroupConfig | null {
  return configs.length > 0 ? configs[0]! : null;
}

/**
 * Monta o valor (JSON) no formato LEGADO (objeto único) para o
 * `cacheSourceGroup` quando não há mirror para montar um config completo.
 * Puro — só serializa.
 */
export function buildLegacySourceGroupValue(
  affiliateId: number,
  groupJid: string,
  groupName?: string,
  mirrorId?: number,
): string {
  return JSON.stringify({
    affiliateId,
    mirrorId,
    groupName: groupName ?? '',
  });
}
