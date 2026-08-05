/**
 * admin-api — painel administrativo single-user do O Mestre Afiliado.
 *
 * Stack: Hono + Bun.serve (sem node-server — Bun serve nativo).
 * Rodando no VPS atrás do Cloudflare Tunnel (admin.omestreafiliado.com.br).
 *
 * Rotas:
 *   /health                          → healthcheck (sem auth)
 *   /api/admin/auth/login|logout|me  → sessão (Basic → Bearer)
 *   /webhook/deploy                  → GitHub Action (ed25519)
 *   /api/admin/deploys*              → histórico + log (session)
 *   /api/admin/test-telegram         → teste de notificação
 */

import { Hono } from 'hono';
import { loadConfig, makeLogger } from './config.ts';
import { authRoutes } from './routes/auth.ts';
import { webhookRoutes } from './routes/webhook.ts';
import { adminRoutes } from './routes/admin.ts';
import { createFeatureFlagsRoutes } from './routes/feature-flags.ts';
import { createWorkerRoutes } from './routes/worker.ts';
import { makeTelegramSender } from './notify/telegram.ts';
import { makeDeployRegistry } from './deploy/registry.ts';

export function createApp(env: Record<string, string | undefined> = process.env) {
  const config = loadConfig(env);
  const log = makeLogger(config.logLevel);

  const telegram = makeTelegramSender(config.telegramBotToken, config.telegramChatId, log);
  const registry = makeDeployRegistry(config.deployStateDir, log);

  const app = new Hono();

  // Healthcheck (sem auth) — usado pelo Docker healthcheck + uptime.
  app.get('/health', (c) =>
    c.json({ success: true, service: 'admin-api', ts: new Date().toISOString() }),
  );

  app.route('/api/admin/auth', authRoutes(log));
  app.route(
    '/webhook',
    webhookRoutes({
      log,
      publicKey: config.deployPublicKey,
      deployScript: config.deployScript,
      deployTimeoutMs: config.deployTimeoutMs,
      telegram,
      registry,
    }),
  );
  app.route(
    '/api/admin',
    adminRoutes({
      log,
      deployScript: config.deployScript,
      deployTimeoutMs: config.deployTimeoutMs,
      telegram,
      registry,
    }),
  );
  // Feature flags + worker status (mounted em /api/admin, mas cada sub-route
  // tem prefixo próprio — /feature-flags e /worker/* — para combinar com o
  // mountpoint existente).
  app.route('/api/admin', createFeatureFlagsRoutes({ log }));
  app.route('/api/admin', createWorkerRoutes({ log, metrics: { config } }));

  // 404 JSON consistente.
  app.notFound((c) => c.json({ success: false, error: 'not found' }, 404));

  return { app, config };
}

// ─── Entrypoint (executado só quando é o entry direto) ────────────────────
// Permite importar `createApp` em testes sem subir servidor.
const isMain = import.meta.main;
if (isMain) {
  const { app, config } = createApp();
  const server = Bun.serve({
    port: config.port,
    fetch: app.fetch,
  });
  console.log(`[admin-api] listening on :${server.port}`);
}
