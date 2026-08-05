/**
 * Configuração do admin-api — funções puras que leem e validam variáveis
 * de ambiente. Não faz I/O além de `process.env`.
 *
 * Variáveis obrigatórias (sem default → throw):
 *   - OMA_ADMIN_USER          username único do admin
 *   - OMA_ADMIN_PASSWORD_HASH hash argon2id (gerado via `bun run hash-password`)
 *   - OMA_DEPLOY_PUBLIC_KEY   chave pública Ed25519 (base64 32 bytes) que
 *                             valida assinaturas do GitHub Action
 *   - OMA_DEPLOY_SCRIPT       caminho absoluto pro script de deploy no VPS
 *   - TELEGRAM_BOT_TOKEN      bot token do @BotFather
 *   - TELEGRAM_CHAT_ID        chat/grupo destino das notificações
 *
 * Variáveis opcionais:
 *   - ADMIN_API_PORT          porta do Hono (default: 9090)
 *   - OMA_DEPLOY_STATE_DIR    onde salvar histórico de deploys (default: /var/lib/oma)
 *   - OMA_DEPLOY_TIMEOUT_MS   timeout do script de deploy (default: 600000 = 10min)
 *   - OMA_LOG_LEVEL           "debug" | "info" | "warn" | "error" (default: info)
 *   - REDIS_URL               conexão Redis para feature flags (default dev: localhost:5455)
 *   - POSTGRES_URL            conexão Postgres para queries (default dev)
 *   - METRICS_API_KEY         chave que bate com apps/worker (vazio = desabilitado)
 *   - WORKER_METRICS_URL      URL do endpoint de métricas do ingestor
 *   - DISPATCHER_METRICS_URL  URL do endpoint de métricas do dispatcher
 *   - R2_ACCOUNT_ID + outras  habilitam backup cifrado (R2 + age)
 */

export interface AdminConfig {
  readonly port: number;
  readonly adminUser: string;
  readonly adminPasswordHash: string;
  readonly deployPublicKey: string;
  readonly deployScript: string;
  readonly deployStateDir: string;
  readonly deployTimeoutMs: number;
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error';
  // ─── Novos (feature flags + worker status) ────────────────────────
  readonly redisUrl: string;
  readonly postgresUrl: string;
  readonly metricsApiKey: string;
  readonly workerMetricsUrl: string;
  readonly dispatcherMetricsUrl: string;
  /** Configuração opcional do backup (R2 + age). Se ausente, backup desabilitado. */
  readonly backup?: {
    r2AccountId: string;
    r2AccessKeyId: string;
    r2SecretAccessKey: string;
    r2Bucket: string;
    agePublicKey: string;
    postgresContainer: string;
    postgresUser: string;
    postgresDatabase: string;
    postgresSchemas: string[];
  };
}

/** Throws se faltar env obrigatório. Retorna config congelada. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AdminConfig {
  const required = [
    'OMA_ADMIN_USER',
    'OMA_ADMIN_PASSWORD_HASH',
    'OMA_DEPLOY_PUBLIC_KEY',
    'OMA_DEPLOY_SCRIPT',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ] as const;

  const missing = required.filter((k) => !env[k] || env[k]!.trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `admin-api: missing required env vars: ${missing.join(', ')}. ` +
        `Check .env or copy from .env.example.`,
    );
  }

  return Object.freeze({
    port: Number(env['ADMIN_API_PORT'] ?? '9090'),
    adminUser: env['OMA_ADMIN_USER']!,
    adminPasswordHash: env['OMA_ADMIN_PASSWORD_HASH']!,
    deployPublicKey: env['OMA_DEPLOY_PUBLIC_KEY']!,
    deployScript: env['OMA_DEPLOY_SCRIPT']!,
    deployStateDir: env['OMA_DEPLOY_STATE_DIR'] ?? '/var/lib/oma',
    deployTimeoutMs: Number(env['OMA_DEPLOY_TIMEOUT_MS'] ?? '600000'),
    telegramBotToken: env['TELEGRAM_BOT_TOKEN']!,
    telegramChatId: env['TELEGRAM_CHAT_ID']!,
    logLevel: (env['OMA_LOG_LEVEL'] ?? 'info') as AdminConfig['logLevel'],
    // ─── Novos (feature flags + worker status). Defaults seguros para dev local. ───
    redisUrl: env['REDIS_URL'] ?? 'redis://localhost:5455',
    postgresUrl:
      env['POSTGRES_URL'] ??
      'postgresql://evolution:omestre_dev@localhost:5453/omestre_db?schema=omestre',
    metricsApiKey: env['METRICS_API_KEY'] ?? '',
    workerMetricsUrl: env['WORKER_METRICS_URL'] ?? 'http://localhost:9092',
    dispatcherMetricsUrl: env['DISPATCHER_METRICS_URL'] ?? 'http://localhost:9093',
    backup: readBackupConfig(env),
  });
}

/**
 * Lê config do backup (R2 + age). Retorna undefined se o backup
 * não estiver habilitado (ex: dev local sem R2 configurado).
 *
 * Para habilitar, basta setar R2_ACCOUNT_ID. As demais são validadas
 * apenas quando o backup está ativo.
 */
function readBackupConfig(env: Record<string, string | undefined>): AdminConfig['backup'] {
  const accountId = env['R2_ACCOUNT_ID'];
  if (!accountId || accountId.trim() === '') return undefined;

  const required: Array<[string, string]> = [
    ['R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID'],
    ['R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY'],
    ['R2_BUCKET', 'R2_BUCKET'],
    ['AGE_PUBLIC_KEY', 'AGE_PUBLIC_KEY'],
    ['POSTGRES_CONTAINER', 'POSTGRES_CONTAINER'],
    ['POSTGRES_USERNAME', 'POSTGRES_USERNAME'],
    ['POSTGRES_DATABASE', 'POSTGRES_DATABASE'],
  ];
  const missing = required
    .filter(([key]) => !env[key] || env[key]!.trim() === '')
    .map(([, label]) => label);

  if (missing.length > 0) {
    throw new Error(
      `admin-api: backup enabled (R2_ACCOUNT_ID set) but missing: ${missing.join(', ')}`,
    );
  }

  return Object.freeze({
    r2AccountId: accountId,
    r2AccessKeyId: env['R2_ACCESS_KEY_ID']!,
    r2SecretAccessKey: env['R2_SECRET_ACCESS_KEY']!,
    r2Bucket: env['R2_BUCKET']!,
    agePublicKey: env['AGE_PUBLIC_KEY']!,
    postgresContainer: env['POSTGRES_CONTAINER']!,
    postgresUser: env['POSTGRES_USERNAME']!,
    postgresDatabase: env['POSTGRES_DATABASE']!,
    postgresSchemas: (env['BACKUP_SCHEMAS'] ?? 'omestre,evolution_api')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  });
}

/** Tipo do logger estruturado retornado por makeLogger. */
export type Logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

/** Logger estruturado minimalista (sem dep externa). */
export function makeLogger(level: AdminConfig['logLevel']): Logger {
  const order: Record<AdminConfig['logLevel'], number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };
  const threshold = order[level];
  return {
    debug: (msg: string, meta?: Record<string, unknown>) =>
      logWith(order.debug, threshold, 'debug', msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) =>
      logWith(order.info, threshold, 'info', msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) =>
      logWith(order.warn, threshold, 'warn', msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) =>
      logWith(order.error, threshold, 'error', msg, meta),
  };
}

function logWith(
  thisLevel: number,
  threshold: number,
  level: string,
  msg: string,
  meta?: Record<string, unknown>,
) {
  if (thisLevel < threshold) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(meta ?? {}),
  };
  process.stdout.write(JSON.stringify(line) + '\n');
}
