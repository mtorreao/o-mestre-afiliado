#!/usr/bin/env bun
/**
 * scripts/deploy-local.ts — Deploy local com validação E2E
 *
 * Fluxo:
 *   1. Build web (pré-requisito para Dockerfile)
 *   2. Rodar testes E2E completos (stack isolada + teardown)
 *   3. Se tudo passar: deploy da stack de produção
 *
 * Uso:
 *   bun run scripts/deploy-local.ts
 *   SKIP_E2E=1 bun run scripts/deploy-local.ts  # pula testes (emergência)
 */

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const E2E_COMPOSE = resolve(ROOT, 'e2e/docker-compose.e2e.yml');
const PROD_COMPOSE = resolve(ROOT, 'docker-compose.yml');
const SKIP_E2E = process.env.SKIP_E2E === '1';

function run(cmd: string, args: string[], label: string): boolean {
  console.log(`\n━━━ ${label} ━━━`);
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
  });
  if (result.status !== 0) {
    console.error(`❌ ${label} falhou (exit code ${result.status})`);
    return false;
  }
  return true;
}

// ─── 1. Build web ────────────────────────────────────────────────────
if (!run('bun', ['run', 'build:web'], 'Build web')) {
  process.exit(1);
}

// ─── 2. E2E Tests ────────────────────────────────────────────────────
if (!SKIP_E2E) {
  console.log('\n━━━ Rodando testes E2E (pré-requisito para deploy) ━━━');

  // Sobe stack E2E
  if (!run('docker', [
    'compose', '-f', E2E_COMPOSE,
    'up', '-d', '--wait', '--build', '--remove-orphans',
  ], 'Subir stack E2E')) {
    process.exit(1);
  }

  // Roda testes
  const testResult = spawnSync('npx', [
    'playwright', 'test', '--config', 'e2e/playwright.config.ts',
  ], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  const testsPassed = testResult.status === 0;

  // Derruba stack E2E (sempre, mesmo se falhar)
  run('docker', [
    'compose', '-f', E2E_COMPOSE,
    'down', '-v', '--remove-orphans', '--timeout', '15',
  ], 'Derrubar stack E2E');

  if (!testsPassed) {
    console.error(`\n❌ ${testResult.status ?? 1} teste(s) falharam — deploy cancelado`);
    console.error('   Corrija os testes ou use SKIP_E2E=1 para deploy de emergência');
    process.exit(1);
  }
  console.log('\n✅ Testes E2E passaram!');
} else {
  console.log('\n⚠️  SKIP_E2E=1 — pulando testes E2E');
}

// ─── 3. Subir produção (com rebuild) ──────────────────────────────────
console.log('\n━━━ Deploy produção ━━━');
if (!run('docker', [
  'compose', '-f', PROD_COMPOSE,
  'up', '-d', '--build', '--remove-orphans',
], 'Deploy produção')) {
  process.exit(1);
}

// ─── 4. Verificar saúde ──────────────────────────────────────────────
console.log('\n━━━ Verificando saúde ━━━');
const healthResult = spawnSync('curl', [
  '-s', '-o', '/dev/null', '-w', '%{http_code}',
  'http://localhost:5442/health',
], {
  cwd: ROOT,
  timeout: 30_000,
  shell: process.platform === 'win32',
});
const healthStatus = parseInt(healthResult.stdout?.toString().trim() || '0', 10);

if (healthStatus === 200) {
  console.log('✅ API saudável (HTTP 200)');
  console.log('\n🚀 Deploy completo!');
  console.log(`   Web:  http://localhost:${process.env.WEB_PORT || '5441'}`);
  console.log(`   API:  http://localhost:${process.env.API_PORT || '5442'}`);
} else {
  console.error(`⚠️  API retornou HTTP ${healthStatus} — verifique os logs`);
  process.exit(1);
}
