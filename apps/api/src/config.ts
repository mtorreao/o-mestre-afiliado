/**
 * Config centralizada da API.
 *
 * Lazy via Proxy para que `resetConfigForTest('api')` entre casos
 * de teste funcione — sem isso, o cache singleton do loadConfig faria
 * com que alterações em `process.env` não tivessem efeito após
 * a 1ª carga.
 */
import { loadConfig, resetConfigForTest, str } from '@omestre/shared';

const SERVICE = 'api';
const SCHEMA = {
  API_PORT: str('API_PORT', { default: '5442' }),
  JWT_SECRET: str('JWT_SECRET'),
  FRONTEND_URL: str('FRONTEND_URL', { default: 'http://localhost:5441' }),
  REDIS_URL: str('REDIS_URL', { default: 'redis://localhost:5455' }),
  EVOLUTION_API_URL: str('EVOLUTION_API_URL', { default: 'http://localhost:5444' }),
  EVOLUTION_API_KEY: str('EVOLUTION_API_KEY', { default: '' }),
  WEBHOOK_URL: str('WEBHOOK_URL', { default: 'http://localhost:5442/webhook/message' }),
  WORKER_METRICS_URL: str('WORKER_METRICS_URL', { default: 'http://localhost:9092' }),
  DISPATCHER_METRICS_URL: str('DISPATCHER_METRICS_URL', { default: 'http://localhost:9093' }),
  METRICS_API_KEY: str('METRICS_API_KEY', { default: '' }),
  ML_CLIENT_ID: str('ML_CLIENT_ID', { default: '' }),
  ML_CLIENT_SECRET: str('ML_CLIENT_SECRET', { default: '' }),
  ML_REDIRECT_URI: str('ML_REDIRECT_URI', { default: 'http://localhost:5442/api/ml/callback' }),
  EXTENSION_LOGS_API_KEY: str('EXTENSION_LOGS_API_KEY', { default: '' }),
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
