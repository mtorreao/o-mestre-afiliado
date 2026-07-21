#!/usr/bin/env bun
/**
 * scripts/test-e2e.ts — Testes E2E completos com lifecycle automático.
 *
 * Uso:
 *   bun run test:e2e                    # sobe stack, roda testes, derruba
 *   SKIP_TEARDOWN=1 bun run test:e2e    # mantém stack rodando após testes
 *
 * Fluxo:
 *   1. Build web (para o Dockerfile)
 *   2. docker compose up -d --wait
 *   3. playwright test
 *   4. docker compose down -v (a menos que SKIP_TEARDOWN=1)
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const COMPOSE_FILE = resolve(ROOT, 'e2e/docker-compose.e2e.yml');

function run(cmd: string, args: string[], label: string): void {
  console.log(`\n━━━ ${label} ━━━`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
  });
  if (result.status !== 0) {
    console.error(`❌ ${label} falhou (exit code ${result.status})`);
    process.exit(result.status ?? 1);
  }
}

// ─── 1. Build web ────────────────────────────────────────────────────
run('bun', ['run', 'build:web'], 'Build web');

// ─── 2. Subir stack ──────────────────────────────────────────────────
run('docker', [
  'compose', '-f', COMPOSE_FILE,
  'up', '-d', '--wait', '--build', '--remove-orphans',
], 'Subir stack E2E');

// ─── 3. Rodar testes ────────────────────────────────────────────────
const testResult = spawnSync('npx', [
  'playwright', 'test', '--config', 'e2e/playwright.config.ts',
], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const testsPassed = testResult.status === 0;

// ─── 4. Derrubar stack ───────────────────────────────────────────────
if (!process.env.SKIP_TEARDOWN) {
  run('docker', [
    'compose', '-f', COMPOSE_FILE,
    'down', '-v', '--remove-orphans', '--timeout', '15',
  ], 'Derrubar stack E2E');
} else {
  console.log('\n⚠️  SKIP_TEARDOWN=1 — stack E2E mantido rodando');
}

if (!testsPassed) {
  console.error(`\n❌ ${testResult.status} teste(s) falharam`);
  process.exit(testResult.status ?? 1);
}

console.log('\n✅ Todos os testes E2E passaram!');
