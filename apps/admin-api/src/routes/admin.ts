/**
 * Rotas administrativas (protegidas por sessão) — painel do admin.
 *
 * GET  /api/admin/deploys             → lista histórico (JSON)
 * GET  /api/admin/deploys/:id/log     → log do deploy (do registry, campo logBody)
 * POST /api/admin/deploys             → dispara deploy manual (body JSON)
 * POST /api/admin/test-telegram       → envia msg de teste
 * GET  /api/admin/health              → healthcheck (não precisa de sessão)
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../config.ts';
import { sessionAuth, type AuthEnv } from '../auth.ts';
import type { TelegramSender } from '../notify/telegram.ts';
import type { DeployRegistry } from '../deploy/registry.ts';
import { runDeployScript } from '../deploy/runner.ts';

export interface AdminDeps {
  log: Logger;
  deployScript: string;
  deployTimeoutMs: number;
  telegram: TelegramSender;
  registry: DeployRegistry;
}

export function adminRoutes(deps: AdminDeps): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.use('*', sessionAuth());

  // GET /api/admin/deploys — lista histórico
  app.get('/deploys', async (c) => {
    const records = await deps.registry.list();
    return c.json({ success: true, deploys: records });
  });

  // GET /api/admin/deploys/:id — detalhe
  app.get('/deploys/:id', async (c) => {
    const id = c.req.param('id');
    const record = await deps.registry.get(id);
    if (!record) return c.json({ success: false, error: 'not found' }, 404);
    return c.json({ success: true, deploy: record });
  });

  // GET /api/admin/deploys/:id/log — log do deploy (vem do registry)
  app.get('/deploys/:id/log', async (c) => {
    const id = c.req.param('id');
    const record = await deps.registry.get(id);
    if (!record) return c.json({ success: false, error: 'not found' }, 404);

    if (record.logBody) {
      return c.text(record.logBody, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    return c.text(record.summary || '(sem log)');
  });

  // POST /api/admin/deploys — deploy manual (body: { ref, sha? })
  app.post('/deploys', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { ref?: string; sha?: string } | null;
    const ref = body?.ref ?? 'manual';
    const sha = body?.sha ?? 'manual';

    const id = randomUUID();
    const record = await deps.registry.create({
      id,
      ref,
      sha,
      triggeredBy: 'manual',
      status: 'running',
      exitCode: null,
      logBody: null,
      summary: 'deploy manual iniciado',
    });

    deps.log.info('deploy manual disparado', { id, ref });
    deps.telegram.send(`🚀 *Deploy manual iniciado*: ${ref} (sha ${sha})`).catch(() => {});

    void runManualDeploy(deps, record.id, ref, sha);
    return c.json({ success: true, deployId: id, status: 'running' }, 202);
  });

  // POST /api/admin/test-telegram
  app.post('/test-telegram', async (c) => {
    const ok = await deps.telegram.send(
      '✅ *Teste do admin-center* — notificação Telegram funcionando.',
    );
    return c.json({ success: ok, sent: ok });
  });

  return app;
}

async function runManualDeploy(
  deps: AdminDeps,
  id: string,
  ref: string,
  sha: string,
): Promise<void> {
  const startedAt = Date.now();
  const result = await runDeployScript(deps.deployScript, deps.deployTimeoutMs, deps.log);

  const status = result.timedOut ? 'timeout' : result.ok ? 'success' : 'failed';
  const durationMs = Date.now() - startedAt;

  const logBody =
    `Deploy manual ${ref} (${sha}) — ${status}\n` +
    `duração: ${(durationMs / 1000).toFixed(1)}s\n` +
    `exit: ${result.exitCode}\n\n` +
    `───── STDOUT ─────\n${result.stdout}\n` +
    `───── STDERR ─────\n${result.stderr}\n`;

  const summary =
    status === 'success'
      ? 'ok'
      : result.timedOut
        ? `timeout após ${Math.round(durationMs / 1000)}s`
        : `exit ${result.exitCode}`;

  await deps.registry.update(id, {
    status,
    finishedAt: new Date().toISOString(),
    durationMs,
    exitCode: result.exitCode,
    logBody,
    summary,
  });

  const emoji = status === 'success' ? '✅' : status === 'timeout' ? '⏱️' : '❌';
  deps.telegram
    .send(`${emoji} *Deploy manual ${status}*: ${ref} — ${(durationMs / 1000).toFixed(1)}s`)
    .catch(() => {});
}
