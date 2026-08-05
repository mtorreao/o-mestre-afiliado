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
      'postgresql://evolution:evolution_pass@localhost:5453/omestre_db?schema=omestre',
    metricsApiKey: env['METRICS_API_KEY'] ?? '',
    workerMetricsUrl: env['WORKER_METRICS_URL'] ?? 'http://localhost:9092',
    dispatcherMetricsUrl: env['DISPATCHER_METRICS_URL'] ?? 'http://localhost:9093',
  });
}

/** Logger estruturado minimalista (sem dep externa). */
export function makeLogger(level: AdminConfig['logLevel']) {
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
  priority: number,
  threshold: number,
  label: string,
  msg: string,
  meta?: Record<string, unknown>,
): void {
  if (priority < threshold) return;
  const record = { level: label, msg, ts: new Date().toISOString(), ...meta };
  process.stdout.write(JSON.stringify(record) + '\n');
}

export type Logger = ReturnType<typeof makeLogger>;
