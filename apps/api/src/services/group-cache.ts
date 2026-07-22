/**
 * Cache Redis para mapeamento sourceGroupJid → affiliateId.
 *
 * Evita consultar o PostgreSQL no hot path do webhook,
 * que recebe milhares de mensagens por dia.
 *
 * Estrutura no Redis:
 *   mirror:source-group:{jid} → { affiliateId: number }
 *
 * O webhook consulta este cache (O(1)), sem fallback ao DB.
 * A população acontece via API quando o usuário configura grupos.
 */

import { getRedis, cacheDel } from './redis.ts';

const CACHE_PREFIX = 'mirror:source-group:';
const CACHE_SET_KEY = 'mirror:source-groups:all';

/**
 * Extrai o affiliateId do cache para um JID de grupo de origem.
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
    const data = JSON.parse(raw) as { affiliateId: number };
    return data.affiliateId;
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
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.set(
      `${CACHE_PREFIX}${groupJid}`,
      JSON.stringify({ affiliateId }),
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
  oldGroups: { jid: string }[],
  newGroups: { jid: string }[],
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
      pipeline.set(
        `${CACHE_PREFIX}${jid}`,
        JSON.stringify({ affiliateId }),
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
