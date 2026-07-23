/**
 * Cache Redis para mapeamento sourceGroupJid → { affiliateId, mirrorId?, groupName }.
 *
 * Evita consultar o PostgreSQL no hot path do webhook,
 * que recebe milhares de mensagens por dia.
 *
 * Estrutura no Redis:
 *   mirror:source-group:{jid} → { affiliateId: number, mirrorId?: number, groupName: string }
 *
 * O campo mirrorId indica que o grupo pertence a um espelhamento (mirror).
 * Quando presente, o worker busca targetGroups e configurações do mirror.
 * Quando ausente, usa a configuração legada do affiliate (affiliates table).
 *
 * O webhook consulta este cache (O(1)), com fallback ao PostgreSQL
 * se a chave não estiver no Redis (TTL expirou, crash, etc.).
 * O fallback popula o cache automaticamente para evitar nova consulta DB.
 *
 * O cache é populado via:
 *   - POST/GET /api/affiliate/groups-config (legado, sem mirrorId)
 *   - POST/PUT /api/mirrors (com mirrorId)
 *   - Limpeza via DELETE /api/mirrors/:id
 */

import { getRedis, cacheDel } from './redis.ts';
import { AffiliatesRepository } from '@omestre/db';

const affiliatesRepo = new AffiliatesRepository();

const CACHE_PREFIX = 'mirror:source-group:';
const CACHE_SET_KEY = 'mirror:source-groups:all';

/** TTL padrão de 1 hora (3600s) para cada entrada no cache. */
const CACHE_TTL = 3600;

/** Informação de cache para um sourceGroup. */
export interface SourceGroupCacheEntry {
  affiliateId: number;
  /** ID do mirror (opcional). Se presente, o worker usa a config do mirror. */
  mirrorId?: number;
  groupName: string;
}

/**
 * Extrai o affiliateId e nome do grupo do cache para um JID de grupo de origem.
 * Retorna null se o JID não for um sourceGroup conhecido.
 *
 * 1. Consulta Redis (O(1)) — hot path
 * 2. Se Redis não tem a chave, consulta PostgreSQL (fallback)
 * 3. Se encontrou no DB, popula o cache automaticamente
 */
export async function getAffiliateIdBySourceGroup(
  groupJid: string,
): Promise<number | null> {
  // ── 1. Tenta Redis ──────────────────────────────────────────────────
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(`${CACHE_PREFIX}${groupJid}`);
      if (raw) {
        const data = JSON.parse(raw) as SourceGroupCacheEntry;
        // Renova o TTL no acesso para manter entradas quentes vivas
        await r.expire(`${CACHE_PREFIX}${groupJid}`, CACHE_TTL).catch(() => {});
        return data.affiliateId;
      }
    } catch {
      // fallback silencioso para PostgreSQL
    }
  }

  // ── 2. Fallback: PostgreSQL ─────────────────────────────────────────
  try {
    const affiliate = await affiliatesRepo.findBySourceGroupJid(groupJid);
    if (affiliate) {
      // Encontrou no DB — popula o cache para evitar nova consulta DB
      const groups = affiliate.sourceGroups as { jid: string; name: string }[] | null;
      const groupName = groups?.find((g) => g.jid === groupJid)?.name ?? '';
      await cacheSourceGroup(groupJid, affiliate.id, groupName);
      console.log(
        `[group-cache] Fallback DB: sourceGroup ${groupJid} carregado para ` +
        `affiliateId=${affiliate.id} (cache foi populado)`,
      );
      return affiliate.id;
    }
  } catch {
    // silencia falha de DB
  }

  return null;
}

/**
 * Versão completa: retorna affiliateId + groupName do cache.
 * Útil quando o caller precisa do nome do grupo para logging ou enriquecimento.
 *
 * 1. Consulta Redis (O(1)) — hot path
 * 2. Se Redis não tem a chave, consulta PostgreSQL (fallback)
 * 3. Se encontrou no DB, popula o cache automaticamente
 */
export async function getSourceGroupInfo(
  groupJid: string,
): Promise<SourceGroupCacheEntry | null> {
  // ── 1. Tenta Redis ──────────────────────────────────────────────────
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(`${CACHE_PREFIX}${groupJid}`);
      if (raw) {
        // Renova o TTL no acesso
        await r.expire(`${CACHE_PREFIX}${groupJid}`, CACHE_TTL).catch(() => {});
        return JSON.parse(raw) as SourceGroupCacheEntry;
      }
    } catch {
      // fallback silencioso para PostgreSQL
    }
  }

  // ── 2. Fallback: PostgreSQL ─────────────────────────────────────────
  try {
    const affiliate = await affiliatesRepo.findBySourceGroupJid(groupJid);
    if (affiliate) {
      const groups = affiliate.sourceGroups as { jid: string; name: string }[] | null;
      const groupName = groups?.find((g) => g.jid === groupJid)?.name ?? '';
      const entry: SourceGroupCacheEntry = { affiliateId: affiliate.id, groupName };
      await cacheSourceGroup(groupJid, affiliate.id, groupName);
      console.log(
        `[group-cache] Fallback DB: sourceGroup ${groupJid} info carregada para ` +
        `affiliateId=${affiliate.id} (cache foi populado)`,
      );
      return entry;
    }
  } catch {
    // silencia falha de DB
  }

  return null;
}

/**
 * Adiciona um sourceGroup ao cache.
 * Chamado quando o usuário configura grupos de espelhamento.
 */
export async function cacheSourceGroup(
  groupJid: string,
  affiliateId: number,
  groupName?: string,
  mirrorId?: number,
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.setex(
      `${CACHE_PREFIX}${groupJid}`,
      CACHE_TTL,
      JSON.stringify({ affiliateId, mirrorId, groupName: groupName ?? '' } as SourceGroupCacheEntry),
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
 * Substitui completamente os sourceGroups de um afiliado ou mirror no cache.
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
  mirrorId?: number,
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
        JSON.stringify({ affiliateId, mirrorId, groupName: newGroup?.name ?? '' } as SourceGroupCacheEntry),
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

/**
 * Warm-up: carrega todos os sourceGroups do PostgreSQL para o Redis.
 *
 * Deve ser chamado no startup da API para garantir que o cache
 * de sourceGroups esteja populado antes de começar a receber
 * webhooks da Evolution API.
 *
 * Loga quantos grupos foram carregados.
 */
export async function warmSourceGroupCache(): Promise<void> {
  try {
    const all = await affiliatesRepo.findAllActiveWithSourceGroups();
    let totalGroups = 0;

    for (const affiliate of all) {
      const groups = affiliate.sourceGroups as { jid: string; name: string }[] | null;
      if (!groups || groups.length === 0) continue;

      for (const group of groups) {
        await cacheSourceGroup(group.jid, affiliate.id, group.name);
        totalGroups++;
      }
    }

    console.log(
      `🔥 Cache de sourceGroups warmado: ${totalGroups} grupo(s) carregado(s) ` +
      `de ${all.length} afiliado(s) ativo(s)`,
    );
  } catch (error) {
    console.error('[group-cache] Erro ao warmar cache de sourceGroups:', error);
  }
}
