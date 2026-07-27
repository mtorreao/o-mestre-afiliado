/**
 * Config centralizada do @omestre/worker-common.
 *
 * Lê env vars uma vez por processo (singleton). Workers e API usam esta
 * config indiretamente via loadConfig.
 */
import { loadConfig, str } from '@omestre/shared';

export const config = loadConfig('worker-common', {
  REDIS_URL: str('REDIS_URL', { default: 'redis://localhost:5455' }),
  EVOLUTION_API_URL: str('EVOLUTION_API_URL', { default: 'http://localhost:5444' }),
  EVOLUTION_API_KEY: str('EVOLUTION_API_KEY'),
});
