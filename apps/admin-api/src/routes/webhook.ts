/**
 * Rotas do webhook de deploy (GitHub Action).
 *
 * POST /webhook/deploy
 *   Header: `X-Oma-Signature: <hex>` (ed25519 de sha256(payload))
 *   Header: `X-Oma-Ref: v0.4.2` (tag/branch)
 *   Header: `X-Oma-Sha: 954d94b` (commit curto)
 *   Body:   JSON com { ref, sha, triggeredBy }
 *
 * Valida assinatura com chave pública → cria registro → roda script de
 * deploy (assíncrono, não bloqueia o request) → atualiza registro com
 * log completo + notifica Telegram.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../config.ts';
import { verifyEd25519Signature } from '../verify-ed25519.ts';
import type { TelegramSender } from '../notify/telegram.ts';
import type { DeployRegistry } from '../deploy/registry.ts';
import { runDeployScript } from '../deploy/runner.ts';

export interface WebhookDeps {
  log: Logger;
  publicKey: string;
  deployScript: string;
  deployTimeoutMs: number;
  telegram: TelegramSender;
  registry: DeployRegistry;
}

export function webhookRoutes(deps: WebhookDeps): Hono {
  const app = new Hono();

  app.post('/deploy', async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header('X-Oma-Signature') ?? '';
    const ref = c.req.header('X-Oma-Ref') ?? '';
    const sha = c.req.header('X-Oma-Sha') ?? '';

    if (!ref || !sha) {
      return c.json({ success: false, error: 'missing X-Oma-Ref or X-Oma-Sha' }, 400);
    }

    // 1. Valida assinatura (ed25519 sobre sha256 do payload cru).
    const valid = await verifyEd25519Signature(rawBody, signature, deps.publicKey);
    if (!valid) {
      deps.log.warn('webhook de deploy com assinatura inválida', { ref, sha });
      return c.json({ success: false, error: 'invalid signature' }, 401);
    }

    // 2. Cria registro e dispara deploy em background.
    const id = randomUUID();
    const record = await deps.registry.create({
      id,
      ref,
      sha,
      triggeredBy: 'github',
      status: 'running',
      exitCode: null,
      logBody: null,
      summary: 'deploy iniciado',
    });

    deps.log.info('webhook validado — iniciando deploy', { id, ref, sha });
    deps.telegram.send(`🚀 *Deploy iniciado*: ${ref} (sha ${sha})`).catch(() => {});

    // Fire-and-forget: o request responde 202 imediatamente.
    void runDeployInBackground(deps, record.id, ref, sha);

    return c.json({ success: true, deployId: id, status: 'running' }, 202);
  });

  return app;
}

async function runDeployInBackground(
  deps: WebhookDeps,
  id: string,
  ref: string,
  sha: string,
): Promise<void> {
  const startedAt = Date.now();
  const result = await runDeployScript(deps.deployScript, deps.deployTimeoutMs, deps.log);

  const status = result.timedOut ? 'timeout' : result.ok ? 'success' : 'failed';
  const durationMs = Date.now() - startedAt;

  const logBody =
    `Deploy ${ref} (${sha}) — ${status}\n` +
    `início: ${new Date(startedAt).toISOString()}\n` +
    `duração: ${(durationMs / 1000).toFixed(1)}s\n` +
    `exit: ${result.exitCode}\n\n` +
    `───── STDOUT ─────\n${result.stdout}\n` +
    `───── STDERR ─────\n${result.stderr}\n`;

  const summary =
    status === 'success'
      ? 'ok'
      : result.timedOut
        ? `timeout após ${Math.round(durationMs / 1000)}s`
        : `exit ${result.exitCode}: ${lastLine(result.stderr) || lastLine(result.stdout)}`;

  await deps.registry.update(id, {
    status,
    finishedAt: new Date().toISOString(),
    durationMs,
    exitCode: result.exitCode,
    logBody,
    summary,
  });

  const emoji = status === 'success' ? '✅' : status === 'timeout' ? '⏱️' : '❌';
  const msg =
    `${emoji} *Deploy ${status}*: ${ref} (sha ${sha})\n` +
    `duração: ${(durationMs / 1000).toFixed(1)}s\n` +
    `exit: ${result.exitCode}\n` +
    (status === 'success' ? '' : `resumo: ${summary}`);
  deps.telegram.send(msg).catch(() => {});
}

function lastLine(text: string): string {
  const lines = text.trim().split('\n').filter(Boolean);
  return lines[lines.length - 1] ?? '';
}
