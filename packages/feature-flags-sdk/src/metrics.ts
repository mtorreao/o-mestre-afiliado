/**
 * Métrica de impacto: quantas vezes uma flag foi consultada na última hora.
 *
 * Best-effort: se Redis estiver indisponível, retorna 0 — quem consome
 * deve tratar isso como "sem dados" e seguir adiante.
 *
 * A métrica é gravada em buckets de 1 minuto no Redis pela feature-flag
 * do app que está consumindo (vide `client.ts` em `@omestre/feature-flags`).
 * Aqui no SDK só expomos o leitor (countFlagChecks) e os helpers para
 * montar a chave (buildFlagStatsKey).
 */

import { getFlagRedis } from './redis.ts';
import { buildFlagStatsKey } from './keys.ts';

const BUCKETS_PER_HOUR = 60;
const BUCKET_MS = 60_000;

/**
 * Soma o número de vezes que a flag foi consultada nos últimos 60 minutos.
 * Retorna 0 se Redis indisponível ou buckets vazios.
 */
export async function countFlagChecks(flagKey: string, redisUrl?: string): Promise<number> {
  const r = getFlagRedis(redisUrl);
  if (!r) return 0;

  const now = Date.now();
  const keys: string[] = [];
  for (let i = 0; i < BUCKETS_PER_HOUR; i++) {
    keys.push(buildFlagStatsKey(flagKey, now - i * BUCKET_MS));
  }

  try {
    const values = await r.mget(...keys);
    let sum = 0;
    for (const v of values) {
      if (v == null) continue;
      const n = Number(v);
      if (!Number.isNaN(n)) sum += n;
    }
    return sum;
  } catch {
    return 0;
  }
}
