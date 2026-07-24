/**
 * Cache Redis para mapeamento sourceGroupJid → SourceGroupConfig[] (1:N).
 *
 * Evita consultar o PostgreSQL no hot path do webhook,
 * que recebe milhares de mensagens por dia.
 *
 * Estrutura no Redis (v2 — 1:N):
 *   mirror:source-group:{jid} → [
 *     { affiliateId, mirrorId, instanceName, targetGroupJid, targetGroupName, messageTemplate, subRateMaxMsgs, subRateWindowSec },
 *     ...
 *   ]
 *
 * O webhook consulta este cache (O(1)), com fallback ao PostgreSQL
 * se a chave não estiver no Redis (TTL expirou, crash, etc.).
 * O fallback popula o cache automaticamente para evitar nova consulta DB.
 *
 * O cache é populado via:
 *   - POST/PUT /api/mirrors (com mirrorId)
 *   - Limpeza via DELETE /api/mirrors/:id
 *   - Warm-up no startup da API
 */

import { getRedis, cacheDel } from './redis.ts';
import { AffiliatesRepository, MirrorRepository } from '@omestre/db';
import type { SourceGroupConfig } from '@omestre/shared';

const affiliatesRepo = new AffiliatesRepository();

const CACHE_PREFIX = 'mirror:source-group:';
const CACHE_SET_KEY = 'mirror:source-groups:all';

/** TTL padrão de 1 hora (3600s) para cada entrada no cache. */
const CACHE_TTL = 3600;

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
  const configs = await getSourceGroupConfigs(groupJid);
  return configs.length > 0 ? configs[0]!.affiliateId : null;
}

/**
 * Versão completa: retorna SourceGroupConfig[] do cache (1:N).
 * Usado pelo webhook para validar se o grupo é um sourceGroup conhecido.
 *
 * 1. Consulta Redis (O(1)) — hot path
 * 2. Se Redis não tem a chave, consulta PostgreSQL (fallback)
 * 3. Se encontrou no DB, popula o cache automaticamente
 */
export async function getSourceGroupInfo(
  groupJid: string,
): Promise<SourceGroupConfig | null> {
  const configs = await getSourceGroupConfigs(groupJid);
  return configs.length > 0 ? configs[0]! : null;
}

/**
 * Busca todas as configurações de sourceGroup para um JID (1:N).
 * Retorna array vazio se não houver mirrors configurados.
 */
export async function getSourceGroupConfigs(
  groupJid: string,
): Promise<SourceGroupConfig[]> {
  // ── 1. Tenta Redis ──────────────────────────────────────────────────
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get(`${CACHE_PREFIX}${groupJid}`);
      if (raw) {
        // Renova o TTL no acesso
        await r.expire(`${CACHE_PREFIX}${groupJid}`, CACHE_TTL).catch(() => {});
        const parsed = JSON.parse(raw);
        // Suporta tanto formato antigo (objeto) quanto novo (array)
        if (Array.isArray(parsed)) {
          return parsed as SourceGroupConfig[];
        }
        // Formato antigo: converte para array
        return [parsed as SourceGroupConfig];
      }
    } catch {
      // fallback silencioso para PostgreSQL
    }
  }

  // ── 2. Fallback: busca na tabela mirrors ─────────────────────────────
  try {
    const mirrorRepo = new MirrorRepository();
    const allMirrors = await mirrorRepo.list({ status: 'active', pageSize: 1000 });
    const configs: SourceGroupConfig[] = [];

    for (const mirror of allMirrors.rows) {
      const groups = mirror.sourceGroups as { jid: string; name: string }[] | null;
      const found = groups?.find((g) => g.jid === groupJid);
      if (found) {
        const instanceName = `user-${mirror.userId}`;
        const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
        if (affiliate) {
          const targetGroups = mirror.targetGroups as { jid: string; name: string }[] | null;
          const targetGroup = targetGroups?.[0];
          if (targetGroup) {
            const config: SourceGroupConfig = {
              affiliateId: affiliate.id,
              mirrorId: mirror.id,
              instanceName,
              targetGroupJid: targetGroup.jid,
              targetGroupName: targetGroup.name,
              messageTemplate: mirror.messageTemplate as string | null,
              subRateMaxMsgs: mirror.subRateLimitMaxMsgs ?? 0,
              subRateWindowSec: mirror.subRateLimitWindowSec ?? 300,
            };
            configs.push(config);
          }
        }
      }
    }

    if (configs.length > 0) {
      await cacheSourceGroupConfigs(groupJid, configs);
      console.log(
        `[group-cache] Fallback mirror: sourceGroup ${groupJid} carregado ` +
        `com ${configs.length} config(s)`,
      );
    }

    return configs;
  } catch {
    // silencia falha de DB
  }

  return [];
}

/**
 * Adiciona configurações de sourceGroup ao cache (1:N).
 * Chamado quando o usuário configura grupos de espelhamento.
 */
export async function cacheSourceGroupConfigs(
  groupJid: string,
  configs: SourceGroupConfig[],
): Promise<void> {
  const r = getRedis();
  if (!r) return;

  try {
    await r.setex(
      `${CACHE_PREFIX}${groupJid}`,
      CACHE_TTL,
      JSON.stringify(configs),
    );
    // Mantém um set com todas as chaves para refresh bulk
    await r.sadd(CACHE_SET_KEY, groupJid);
  } catch {
    // silencia falha de cache
  }
}

/**
 * Adiciona um sourceGroup ao cache (legado — 1:1).
 * Mantido para compatibilidade com código antigo.
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
    // Busca o mirror completo para montar o SourceGroupConfig
    if (mirrorId) {
      const mirrorRepo = new MirrorRepository();
      const mirror = await mirrorRepo.findById(mirrorId);
      if (mirror) {
        const instanceName = `user-${mirror.userId}`;
        const targetGroups = mirror.targetGroups as { jid: string; name: string }[] | null;
        const targetGroup = targetGroups?.[0];
        if (targetGroup) {
          const config: SourceGroupConfig = {
            affiliateId,
            mirrorId,
            instanceName,
            targetGroupJid: targetGroup.jid,
            targetGroupName: targetGroup.name,
            messageTemplate: mirror.messageTemplate as string | null,
            subRateMaxMsgs: mirror.subRateLimitMaxMsgs ?? 0,
            subRateWindowSec: mirror.subRateLimitWindowSec ?? 300,
          };
          await cacheSourceGroupConfigs(groupJid, [config]);
          return;
        }
      }
    }

    // Fallback: salva no formato antigo (será convertido em array no getSourceGroupConfigs)
    await r.setex(
      `${CACHE_PREFIX}${groupJid}`,
      CACHE_TTL,
      JSON.stringify({ affiliateId, mirrorId, groupName: groupName ?? '' }),
    );
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
 *   3. Adiciona os novos com SourceGroupConfig completo
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

    // Busca o mirror completo para montar SourceGroupConfig
    if (mirrorId) {
      const mirrorRepo = new MirrorRepository();
      const mirror = await mirrorRepo.findById(mirrorId);
      if (mirror) {
        const instanceName = `user-${mirror.userId}`;
        const targetGroups = mirror.targetGroups as { jid: string; name: string }[] | null;
        const targetGroup = targetGroups?.[0];
        if (targetGroup) {
          for (const jid of newJids) {
            const newGroup = newGroups.find((g) => g.jid === jid);
            const config: SourceGroupConfig = {
              affiliateId,
              mirrorId,
              instanceName,
              targetGroupJid: targetGroup.jid,
              targetGroupName: targetGroup.name,
              messageTemplate: mirror.messageTemplate as string | null,
              subRateMaxMsgs: mirror.subRateLimitMaxMsgs ?? 0,
              subRateWindowSec: mirror.subRateLimitWindowSec ?? 300,
            };
            pipeline.setex(
              `${CACHE_PREFIX}${jid}`,
              CACHE_TTL,
              JSON.stringify([config]),
            );
            pipeline.sadd(CACHE_SET_KEY, jid);
          }
        }
      }
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
    // Carrega sourceGroups de mirrors (CRUD atual)
    const mirrorRepo = new MirrorRepository();
    const mirrorResult = await mirrorRepo.list({ status: 'active', pageSize: 1000 });
    let totalGroups = 0;

    for (const mirror of mirrorResult.rows) {
      const srcGroups = mirror.sourceGroups as { jid: string; name: string }[] | null;
      if (!srcGroups || srcGroups.length === 0) continue;

      // Encontra o affiliate pelo evolutionInstanceId (user-{userId})
      const instanceName = `user-${mirror.userId}`;
      const affiliate = await affiliatesRepo.findByEvolutionInstanceId(instanceName);
      if (!affiliate) continue;

      const targetGroups = mirror.targetGroups as { jid: string; name: string }[] | null;
      const targetGroup = targetGroups?.[0];
      if (!targetGroup) continue;

      // Agrupa configs por sourceGroupJid (pode haver múltiplos mirrors para o mesmo grupo)
      for (const group of srcGroups) {
        const config: SourceGroupConfig = {
          affiliateId: affiliate.id,
          mirrorId: mirror.id,
          instanceName,
          targetGroupJid: targetGroup.jid,
          targetGroupName: targetGroup.name,
          messageTemplate: mirror.messageTemplate as string | null,
          subRateMaxMsgs: mirror.subRateLimitMaxMsgs ?? 0,
          subRateWindowSec: mirror.subRateLimitWindowSec ?? 300,
        };

        // Busca configs existentes para este grupo (1:N)
        const existing = await getSourceGroupConfigs(group.jid);
        const updated = [...existing, config];
        await cacheSourceGroupConfigs(group.jid, updated);
        totalGroups++;
      }
    }

    console.log(
      `🔥 Cache de sourceGroups warmado: ${totalGroups} grupo(s) carregado(s) do mirrors table`,
    );
  } catch (error) {
    console.error('[group-cache] Erro ao warmar cache de sourceGroups:', error);
  }
}
