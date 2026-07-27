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
 */
import type { SourceGroupConfig } from '@omestre/shared';
import { MIRROR_SOURCE_GROUP_CACHE_PREFIX } from '@omestre/shared';
import { getRedis } from './redis.ts';

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
    const key = `${MIRROR_SOURCE_GROUP_CACHE_PREFIX}${sourceGroupJid}`;
    const raw = await r.get(key);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    const configs = Array.isArray(parsed) ? parsed : [parsed];

    // Filtra apenas configs completos (com instanceName)
    return configs.filter((c: SourceGroupConfig) => c.instanceName && c.targetGroupJid);
  } catch {
    return [];
  }
}
