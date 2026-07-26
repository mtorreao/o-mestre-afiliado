#!/usr/bin/env bun
/**
 * scripts/test-unit.ts — Roda testes unitários (bun test) com escopo restrito.
 *
 * Sem este script, `bun test` na raiz varre TUDO recursivamente,
 * incluindo os specs E2E do Playwright em e2e/*.spec.ts (que usam
 * `test.describe()` do Playwright e dão erro fora do `playwright test`).
 *
 * Aqui iteramos apps/* e packages/*, rodando `bun test` em cada
 * subprojeto individualmente — assim cada um roda SÓ os *.test.ts
 * do próprio package, e os E2E (que vivem em /e2e) nunca são tocados.
 *
 * Uso:
 *   bun run scripts/test-unit.ts
 *   bun run test:unit  (atalho em package.json)
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const ROOT = resolve(import.meta.dir, '..');

function hasTestFiles(dir: string): boolean {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (hasTestFiles(full)) return true;
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function listSubprojectsWithTests(dir: string): string[] {
  const abs = resolve(ROOT, dir);
  try {
    return readdirSync(abs)
      .filter((name) => {
        const subdir = resolve(abs, name);
        const tsconfig = resolve(subdir, 'tsconfig.json');
        try {
          if (!statSync(tsconfig).isFile()) return false;
        } catch {
          return false;
        }
        const srcDir = resolve(subdir, 'src');
        try {
          if (!statSync(srcDir).isDirectory()) return false;
        } catch {
          return false;
        }
        return hasTestFiles(srcDir);
      })
      .map((name) => resolve(abs, name));
  } catch {
    return [];
  }
}

const subprojects = [
  ...listSubprojectsWithTests('apps'),
  ...listSubprojectsWithTests('packages'),
].sort();

if (subprojects.length === 0) {
  console.log('⚠️  Nenhum subprojeto com *.test.ts encontrado — pulando.');
  process.exit(0);
}

console.log(`🧪 Rodando unit tests em ${subprojects.length} subprojeto(s)...\n`);

let failed = 0;
for (const dir of subprojects) {
  const rel = dir.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
  const name = rel.split('/').slice(-2).join('/');
  console.log(`  → ${name}`);
  const result = spawnSync('bun', ['test'], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
  });
  if (result.status !== 0) {
    failed++;
  }
  console.log();
}

if (failed > 0) {
  console.error(`❌ ${failed} subprojeto(s) com testes falhando`);
  process.exit(1);
}
console.log(`✅ Todos os unit tests passaram`);
