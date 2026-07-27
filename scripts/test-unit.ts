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
 * Os testes rodam em paralelo (cada subprojeto é independente) e o
 * output é suprimido durante a execução; no final mostramos um resumo
 * consolidado por projeto e (em caso de falha) os erros reais de quem
 * quebrou, em vez do log bagunçado sequencial.
 *
 * Uso:
 *   bun run scripts/test-unit.ts
 *   bun run test:unit  (atalho em package.json)
 */
import { spawn } from 'node:child_process';
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

console.log(`🧪 Rodando unit tests em ${subprojects.length} subprojeto(s) em paralelo...\n`);

type ProjectResult = {
  name: string;
  rel: string;
  passed: number;
  failed: number;
  durationMs: number;
  exitCode: number;
  rawOutput: string;
};

async function runProject(dir: string): Promise<ProjectResult> {
  const rel = dir.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
  const name = rel.split('/').slice(-2).join('/');
  const startedAt = Date.now();

  return new Promise((resolveRun) => {
    const child = spawn('bun', ['test'], {
      cwd: dir,
      env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      shell: process.platform === 'win32',
    });

    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c) => chunks.push(Buffer.from(c)));
    child.stderr?.on('data', (c) => chunks.push(Buffer.from(c)));

    child.on('close', (code) => {
      const rawOutput = Buffer.concat(chunks).toString('utf8');
      // bun test imprime no fim: "Ran N tests across M files. [Xs]"
      // e também "N pass / N fail". Vamos extrair com regex tolerantes.
      const passMatch = rawOutput.match(/^\s*(\d+)\s+pass\s*$/m);
      const failMatch = rawOutput.match(/^\s*(\d+)\s+fail\s*$/m);
      const ranMatch = rawOutput.match(/Ran\s+(\d+)\s+tests?\s+across/i);

      const passed = passMatch ? Number(passMatch[1]) : 0;
      const failed = failMatch ? Number(failMatch[1]) : 0;
      // Se não conseguimos extrair "Ran N tests", caímos no total pass+fail
      const totalReported = ranMatch ? Number(ranMatch[1]) : passed + failed;

      resolveRun({
        name,
        rel,
        passed,
        failed,
        durationMs: Date.now() - startedAt,
        exitCode: code ?? 0,
        rawOutput,
        // anota pra debug se a extração falhou
        ...(totalReported === 0 && passed === 0 && failed === 0
          ? { rawOutput: rawOutput + '\n[warn: não foi possível extrair contagem]' }
          : {}),
      } as ProjectResult);
    });
  });
}

const results = await Promise.all(subprojects.map(runProject));

// Ordena por caminho para saída estável
results.sort((a, b) => a.rel.localeCompare(b.rel));

const totalPassed = results.reduce((acc, r) => acc + r.passed, 0);
const totalFailed = results.reduce((acc, r) => acc + r.failed, 0);
const failedProjects = results.filter((r) => r.exitCode !== 0);
const ok = failedProjects.length === 0;

// Resumo agrupado
console.log('━'.repeat(60));
console.log(`📊 Resumo — ${results.length} subprojeto(s)`);
console.log('━'.repeat(60));
for (const r of results) {
  const status = r.exitCode === 0 ? '✅' : '❌';
  const counts =
    r.passed + r.failed > 0 ? `${r.passed} pass / ${r.failed} fail` : 'sem contagem extraída';
  const ms = `${(r.durationMs / 1000).toFixed(2)}s`;
  console.log(`  ${status} ${r.name.padEnd(28)} ${counts.padEnd(22)} ${ms}`);
}
console.log('━'.repeat(60));
console.log(`Total: ${totalPassed} pass, ${totalFailed} fail em ${results.length} projeto(s)`);
console.log('━'.repeat(60));

// Detalhes só dos que falharam — salva em arquivo local e imprime caminho
let failureLogPath: string | null = null;
if (!ok) {
  const logDir = resolve(ROOT, '.logs');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  failureLogPath = resolve(logDir, `test-unit-failures-${stamp}.log`);

  const sections = failedProjects.map((r) => {
    const sep = '━'.repeat(60);
    return [
      `${sep}`,
      `❌ ${r.name}  (exit ${r.exitCode}, ${r.passed} pass / ${r.failed} fail)`,
      sep,
      r.rawOutput.endsWith('\n') ? r.rawOutput : r.rawOutput + '\n',
    ].join('\n');
  });

  await Bun.write(failureLogPath, sections.join('\n'));

  console.log('');
  for (const r of failedProjects) {
    console.log('');
    console.log(`❌ ${r.name} — output completo:`);
    console.log('─'.repeat(60));
    process.stdout.write(r.rawOutput.endsWith('\n') ? r.rawOutput : r.rawOutput + '\n');
    console.log('─'.repeat(60));
  }
  console.log('');
  console.log(`📄 Log consolidado das falhas salvo em: ${failureLogPath}`);
  process.exit(1);
}

console.log('\n✅ Todos os unit tests passaram');
