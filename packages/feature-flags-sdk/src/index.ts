/**
 * @omestre/feature-flags-sdk — Infra Redis compartilhada para feature flags.
 *
 * Conteúdo:
 *   - `keys`       — prefixos + formato de bucket + builders de chave
 *   - `redis`      — singleton lazy de ioredis (best-effort fallback silencioso)
 *   - `pubsub`     — publish/subscribe no canal `omestre:flag:invalidate`
 *   - `metrics`    — leitor de stats por minuto (countFlagChecks)
 *
 * Sem lógica de resolução de flag: o SDK é puramente infra. Resolução
 * (cache local + DB + default) vive no consumer (`packages/feature-flags` ou
 * custom de cada app).
 */

export {
  FLAG_STATS_KEY_PREFIX,
  FLAG_INVALIDATE_CHANNEL,
  buildFlagStatsKey,
  bucketAt,
  type FlagStatsBucket,
} from './keys.ts';

export { getFlagRedis, __resetFlagRedisForTesting, __setRedisFactoryForTesting } from './redis.ts';

export {
  publishFlagInvalidation,
  subscribeFlagInvalidation,
  type InvalidateCallback,
} from './pubsub.ts';

export { countFlagChecks } from './metrics.ts';
