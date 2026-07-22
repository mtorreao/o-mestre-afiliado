/**
 * Cache Redis para mapeamento sourceGroupJid → { affiliateId, groupName }.
 *
 * Evita consultar o PostgreSQL no hot path do webhook,
 * que recebe milhares de mensagens por dia.
 *
 * Estrutura no Redis:
 *   mirror:source-group:{jid} → { affiliateId: number, groupName: string }
 *
 * O webhook consulta este cache (O(1)), sem fallback ao DB.
 * A população acontece via API quando o usuário configura grupos.
 */

import { getRedis, cacheDel } from './redis.ts';

const CACHE_PREFIX = 'mirror:source-group:';
const CACHE_SET_KEY = 'mirror:source-groups:all';

/** TTL padrão de 1 hora (3600s) para cada entrada no cache. */
const CACHE_TTL = 3600;

/** Informação de cache para um sourceGroup. */
export interface SourceGroupCacheEntry {
  affiliateId: number;
  groupName: string;
}

/**
 * Extrai o affiliateId e nome do grupo do cache para um JID de grupo de origem.
 * Retorna null se o JID não for um sourceGroup conhecido.
 *
 * NÃO consulta o banco — apenas Redis. Se não estiver no cache,
 * a mensagem não é de um grupo de espelhamento configurado.
 */
export async function getAffiliateIdBySourceGroup(
  groupJid: string,
): Promise<number | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const raw = await r.get(`${CACHE_PREFIX}${groupJid}`);
    if (!raw) return null;
    const data = JSON.parse(raw) as SourceGroupCacheEntry;
    // Renova o TTL no acesso para manter entradas quentes vivas
    await r.expire(`${CACHE_PREFIX}${groupJid}`, CACHE_TTL).catch(() => {});
    return data.affiliateId;
  } catch {
    return null;
  }
}

/**
 * Versão completa: retorna affiliateId + groupName do cache.
 * Útil quando o caller precisa do nome do grupo para logging ou enriquecimento.
 */
export async function getSourceGroupInfo(
  groupJid: string,
): Promise<SourceGroupCacheEntry | null> {
  const r = getRedis();
  if (!r) return null;

  try {
    const raw = await r.get(`${CACHE_PREFIX}${groupJid}`);
    if (!raw) return null;
    // Renova o TTL no acesso
    await r.expire(`${CACHE_PREFIX}${groupJid}`, CACHE_TTL).catch(() => {});
    return JSON.parse(raw) as SourceGroupCacheEntry;
  } catch {
    return null;
  }
}

/**
 * Adiciona um sourceGroup ao cache.
 * Chamado quando o usuário configura grupos de espelhamento.
 */
export async function cacheSourceGroup(
  groupJid: string,
  affiliateId: number,
  groupName?: string,
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.setex(
      `${CACHE_PREFIX}${groupJid}`,
      CACHE_TTL,
      JSON.stringify({ affiliateId, groupName: groupName ?? '' } as SourceGroupCacheEntry),
    );
    // Mantém um set com todas as chaves para refresh bulk
    await r.sadd(CACHE_SET_KEY, groupJid);
  } catch {
    // silencia falha de cache
  }
}

/**
 * Remove um sourceGroup do cache.
 * Chamado quando o usuário remove um grupo ou altera a configuração.
 */
export async function removeSourceGroup(groupJid: string): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await cacheDel(`${CACHE_PREFIX}${groupJid}`);
    await r.srem(CACHE_SET_KEY, groupJid);
  } catch {
    // silencia
  }
}

/**
 * Remove múltiplos grupos do cache de uma vez.
 */
export async function removeSourceGroups(jids: string[]): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    if (jids.length === 0) return;
    const pipeline = r.pipeline();
    for (const jid of jids) {
      pipeline.del(`${CACHE_PREFIX}${jid}`);
      pipeline.srem(CACHE_SET_KEY, jid);
    }
    await pipeline.exec();
  } catch {
    // silencia
  }
}

/**
 * Substitui completamente os sourceGroups de um afiliado no cache.
 *
 * Estratégia:
 *   1. Busca todos os sourceGroups atuais deste afiliado no Redis
 *   2. Remove os que não estão mais na nova lista
 *   3. Adiciona os novos
 *
 * Isso garante que grupos removidos da configuração não fiquem
 * poluindo o cache.
 */
export async function replaceSourceGroups(
  oldGroups: { jid: string; name?: string }[],
  newGroups: { jid: string; name?: string }[],
  affiliateId: number,
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  const oldJids = new Set(oldGroups.map((g) => g.jid));
  const newJids = new Set(newGroups.map((g) => g.jid));

  // Grupos que existiam mas não estão mais na nova config
  const removed = [...oldJids].filter((jid) => !newJids.has(jid));

  try {
    const pipeline = r.pipeline();
    for (const jid of removed) {
      pipeline.del(`${CACHE_PREFIX}${jid}`);
      pipeline.srem(CACHE_SET_KEY, jid);
    }
    for (const jid of newJids) {
      const newGroup = newGroups.find((g) => g.jid === jid);
      pipeline.setex(
        `${CACHE_PREFIX}${jid}`,
        CACHE_TTL,
        JSON.stringify({ affiliateId, groupName: newGroup?.name ?? '' } as SourceGroupCacheEntry),
      );
      pipeline.sadd(CACHE_SET_KEY, jid);
    }
    await pipeline.exec();
  } catch {
    // silencia
  }
}

/**
 * Limpa todo o cache de sourceGroups.
 * Útil em reset ou quando a estrutura mudar.
 */
export async function clearSourceGroupCache(): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    const members = await r.smembers(CACHE_SET_KEY);
    if (members.length === 0) return;

    const pipeline = r.pipeline();
    for (const jid of members) {
      pipeline.del(`${CACHE_PREFIX}${jid}`);
    }
    pipeline.del(CACHE_SET_KEY);
    await pipeline.exec();
  } catch {
    // silencia
  }
}
