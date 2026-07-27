/**
 * Config centralizada do Ingestor.
 *
 * Lazy via Proxy para que `resetConfigForTest('ingestor')` entre
 * casos de teste funcione — sem isso, o cache singleton do loadConfig
 * faria com que alterações em `process.env` não tivessem efeito após
 * a 1ª carga.
 */
import { loadConfig, resetConfigForTest, str } from '@omestre/shared';

const SERVICE = 'ingestor';
const SCHEMA = {
  REDIS_URL: str('REDIS_URL', { default: 'redis://localhost:5455' }),
  BLACKLIST_PATH: str('BLACKLIST_PATH', { default: '../../blacklist.json' }),
  WHITELIST_PATH: str('WHITELIST_PATH', { default: '../../whitelist.json' }),
  WORKER_CONVERSION_CACHE_TTL: str('WORKER_CONVERSION_CACHE_TTL'),
} as const;

type Config = ReturnType<typeof loadConfig<typeof SCHEMA>>;

/**
 * Lazy config — cada acesso chama loadConfig() que cacheia. Use
 * `config.reset()` em testes antes de alterar env vars em runtime.
 */
export const config: Config & { reset: () => void } = new Proxy(
  {} as Config & { reset: () => void },
  {
    get(_target, prop) {
      if (prop === 'reset') return () => resetConfigForTest(SERVICE);
      const cfg = loadConfig(SERVICE, SCHEMA);
      return cfg[prop as keyof Config];
    },
  },
);
