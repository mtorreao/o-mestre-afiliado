/**
 * Executor de deploy — roda o script de deploy do VPS com timeout e
 * captura stdout/stderr. Não faz rede, só child_process.
 */

import { spawn } from 'node:child_process';
import type { Logger } from '../config.ts';

export interface DeployScriptResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Roda o script de deploy (ex: /root/o-mestre-afiliado/scripts/deploy-prod.sh)
 * com timeout. Resolve com resultado estruturado — nunca lança.
 */
export function runDeployScript(
  scriptPath: string,
  timeoutMs: number,
  log: Logger,
): Promise<DeployScriptResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    log.info('iniciando deploy script', { scriptPath, timeoutMs });

    const child = spawn(scriptPath, {
      shell: '/bin/bash',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      log.warn('deploy script timeout — matando processo', { scriptPath, timeoutMs });
      child.kill('SIGTERM');
      // Força kill após 5s caso SIGTERM não resolva.
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5000);
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        exitCode: null,
        stdout,
        stderr: `${stderr}\nspawn error: ${err.message}`,
        durationMs: Date.now() - started,
        timedOut,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - started;
      log.info('deploy script finalizado', { exitCode: code, durationMs, timedOut });
      resolve({
        ok: code === 0 && !timedOut,
        exitCode: code,
        stdout,
        stderr,
        durationMs,
        timedOut,
      });
    });
  });
}
