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

// ─── 2.5. Warmup: aguarda Evolution API ficar responsiva ───────────
// Após o healthcheck passar, a Evolution API pode levar alguns
// segundos para inicializar internamente o endpoint de criação
// de instâncias. Fazemos algumas tentativas para evitar falsos
// positivos nos testes de conexão WhatsApp.
const EVO_URL = `http://localhost:${process.env.EVOLUTION_PORT || '15444'}`;
const EVO_API_KEY = process.env.EVOLUTION_API_KEY || 'e2e-evolution-api-key';
const MAX_RETRIES = 5;
console.log(`\n━━━ Warmup Evolution API (${EVO_URL}) ━━━`);
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    const res = await fetch(`${EVO_URL}/instance/fetchInstances`, {
      headers: { apikey: EVO_API_KEY },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      console.log(`  ✓ Evolution API respondendo (tentativa ${attempt})`);
      break;
    }
  } catch {
    // ignora
  }
  if (attempt < MAX_RETRIES) {
    console.log(`  ⏳ Aguardando Evolution API (tentativa ${attempt}/${MAX_RETRIES})...`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

// ─── 2.6. Warmup: verifica se o simulador está respondendo ─────────
const SIMULATOR_URL = `http://localhost:${process.env.SIMULATOR_PORT || '15446'}`;
console.log(`\n━━━ Warmup Simulador WhatsApp (${SIMULATOR_URL}) ━━━`);
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const res = await fetch(`${SIMULATOR_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      console.log(`  ✓ Simulador respondendo (tentativa ${attempt})`);
      break;
    }
  } catch {
    // ignora
  }
  if (attempt < 5) {
    console.log(`  ⏳ Aguardando Simulador (tentativa ${attempt}/5)...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ─── 3. Rodar testes ────────────────────────────────────────────────
const testResult = spawnSync('bun', [
  'x', 'playwright', 'test', '--config', 'e2e/playwright.config.ts',
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
