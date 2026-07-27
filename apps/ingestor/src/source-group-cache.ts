/**
 * Source Group Config (cache 1:N Redis).
 *
 * Para cada sourceGroupJid, mantém em Redis a lista de mirrors que
 * escutam esse grupo (1:N — um source pode ter vários destinos).
 *
 * Populada no startup do Ingestor e via API no save de mirrors.
 *
 * Variáveis de ambiente:
 *  - REDIS_URL (default: redis://localhost:5455)
 *
 * A lógica de parse/filtro do payload do Redis foi extraída para a
 * função PURA `parseSourceGroupConfigs` — testável sem Redis, cobrindo
 * JSON válido (array ou objeto único), JSON inválido e o filtro de
 * configs incompletos.
 */
import type { SourceGroupConfig } from '@omestre/shared';
import { MIRROR_SOURCE_GROUP_CACHE_PREFIX } from '@omestre/shared';
import { getRedis } from './redis.ts';

/** Constrói a chave Redis para um sourceGroupJid. */
export function sourceGroupCacheKey(sourceGroupJid: string): string {
  return `${MIRROR_SOURCE_GROUP_CACHE_PREFIX}${sourceGroupJid}`;
}

/**
 * Faz o parse + filtro do payload crus do Redis (string JSON).
 *
 * Regras (puras):
 *  - `raw` nulo/vazio → [].
 *  - JSON inválido → [] (modo degradado, falha silenciosa).
 *  - Array JSON → normaliza; objeto único → envolve em [objeto].
 *  - Mantém apenas configs COMPLETOS (com `instanceName` E `targetGroupJid`).
 *
 * NÃO acessa Redis — recebe a string já lida. A camada de I/O
 * (get/JSON.parse tolerante) vive em `getSourceGroupConfigs`.
 */
export function parseSourceGroupConfigs(raw: string | null | undefined): SourceGroupConfig[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const configs = Array.isArray(parsed) ? parsed : [parsed];

  // Filtra apenas configs completos (com instanceName E targetGroupJid).
  // Mantém a semântica truthy original (c.instanceName && c.targetGroupJid).
  return configs.filter(
    (c): c is SourceGroupConfig =>
      !!c &&
      typeof c === 'object' &&
      !!(c as object & { instanceName?: unknown }).instanceName &&
      !!(c as object & { targetGroupJid?: unknown }).targetGroupJid,
  ) as SourceGroupConfig[];
}

/**
 * Retorna as configs de mirrors que escutam o sourceGroupJid.
 *
 * Filtra apenas configs completos (com instanceName e targetGroupJid).
 * Retorna [] em modo degradado (Redis=null) ou quando a chave não
 * existe — callers devem tratar como "sem afiliação configurada".
 */
export async function getSourceGroupConfigs(sourceGroupJid: string): Promise<SourceGroupConfig[]> {
  const r = getRedis();
  if (!r) return [];

  try {
    const raw = await r.get(sourceGroupCacheKey(sourceGroupJid));
    return parseSourceGroupConfigs(raw);
  } catch {
    return [];
  }
}
