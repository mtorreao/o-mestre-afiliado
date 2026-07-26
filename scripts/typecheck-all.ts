#!/usr/bin/env bun
/**
 * scripts/typecheck-all.ts — Typecheck de todos os subprojetos.
 *
 * Itera apps/* e packages/* executando `tsc --noEmit` em cada um
 * a partir do seu próprio diretório (assim cada subprojeto resolve
 * seus módulos a partir do próprio node_modules).
 *
 * Uso:
 *   bun run scripts/typecheck-all.ts
 *   bun run typecheck:all   (atalho em package.json)
 *
 * Saída: exit 0 se tudo passa, 1 se algum subprojeto falhar.
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

const ROOT = resolve(import.meta.dir, '..');

function listSubprojects(dir: string): string[] {
  const abs = resolve(ROOT, dir);
  try {
    return readdirSync(abs)
      .filter((name) => {
        const tsconfig = resolve(abs, name, 'tsconfig.json');
        try {
          return statSync(tsconfig).isFile();
        } catch {
          return false;
        }
      })
      .map((name) => resolve(abs, name));
  } catch {
    return [];
  }
}

const subprojects = [...listSubprojects('apps'), ...listSubprojects('packages')].sort();

if (subprojects.length === 0) {
  console.error('❌ Nenhum subprojeto com tsconfig.json encontrado');
  process.exit(1);
}

console.log(`🔍 Typechecking ${subprojects.length} subprojeto(s)...\n`);

let failed = 0;
for (const dir of subprojects) {
  const rel = dir.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
  const name = rel.split('/').slice(-2).join('/');
  process.stdout.write(`  → ${name} ... `);
  const result = spawnSync('bunx', ['tsc', '--noEmit'], {
    cwd: dir,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
  });
  if (result.status === 0) {
    console.log('✅');
  } else {
    console.log('❌');
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    failed++;
  }
}

console.log();
if (failed > 0) {
  console.error(`❌ ${failed} subprojeto(s) com erro de typecheck`);
  process.exit(1);
}
console.log(`✅ Todos os ${subprojects.length} subprojetos passaram`);
