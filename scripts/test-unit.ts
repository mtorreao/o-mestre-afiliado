#!/usr/bin/env bun
/**
 * scripts/test-unit.ts — Roda testes unitários (bun test) com escopo restrito.
 *
 * Sem este script, `bun test` na raiz varre TUDO recursivamente,
 * incluindo os specs E2E do Playwright em e2e/*.spec.ts (que usam
 * `test.describe()` do Playwright e dão erro fora do `playwright test`).
 *
 * Aqui listamos CADA arquivo *.test.ts e *.test.tsx em apps/* / src e
 * packages/* / src e rodamos `bun test <arquivo>` em processo SEPARADO para
 * cada arquivo. Isso é deliberado: o `mock.module` do Bun é GLOBAL ao
 * processo bun test, e varios arquivos de teste do apps/api registram mocks
 * de `@omestre/db` / `middleware/auth.ts` no topo sem restaurar. Se todos os
 * arquivos de um subprojeto rodassem no mesmo processo, os mocks vazariam de
 * um arquivo para outro e o resultado ficaria dependente da ordem de execucao
 * (que difere entre Windows e Linux). Rodar 1 arquivo por processo elimina o
 * vazamento de forma deterministica, sem precisar mexer em cada teste.
 *
 * Os arquivos rodam em lotes paralelos (WORKERS) e o output e supremido
 * durante a execucao; no final mostramos um resumo consolidado e (em caso de
 * falha) os erros reais de quem quebrou.
 *
 * Uso:
 *   bun run scripts/test-unit.ts
 *   bun run test:unit  (atalho em package.json)
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

const ROOT = resolve(import.meta.dir, '..');
const WORKERS = Number(process.env.TEST_UNIT_WORKERS ?? 4);

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'fixtures') continue;
        out.push(...listTestFiles(full));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx'))
      ) {
        out.push(full);
      }
    }
  } catch {
    return out;
  }
  return out;
}

function listAllTestFiles(): string[] {
  const dirs = [
    ...readdirSync(resolve(ROOT, 'apps'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => resolve(ROOT, 'apps', e.name, 'src')),
    ...readdirSync(resolve(ROOT, 'packages'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => resolve(ROOT, 'packages', e.name, 'src')),
  ];
  const files = dirs.flatMap((d) => listTestFiles(d));
  return files.sort();
}

const files = listAllTestFiles();

if (files.length === 0) {
  console.log('⚠️  Nenhum arquivo *.test.ts/tsx encontrado — pulando.');
  process.exit(0);
}

console.log(
  `🧪 Rodando ${files.length} arquivo(s) de teste (1 processo por arquivo, ${WORKERS} em paralelo)...\n`,
);

type FileResult = {
  rel: string;
  passed: number;
  failed: number;
  durationMs: number;
  exitCode: number;
  rawOutput: string;
};

function runOneFile(file: string): Promise<FileResult> {
  let rel = file.slice(ROOT.length).split('\\').join('/');
  if (rel.startsWith('/')) rel = rel.slice(1);
  const startedAt = Date.now();
  return new Promise((resolveRun) => {
    const child = spawn('bun', ['test', file], {
      cwd: ROOT,
      env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      shell: process.platform === 'win32',
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c) => chunks.push(Buffer.from(c)));
    child.stderr?.on('data', (c) => chunks.push(Buffer.from(c)));
    child.on('close', (code) => {
      const rawOutput = Buffer.concat(chunks).toString('utf8');
      const passMatch = rawOutput.match(/^\s*(\d+)\s+pass\s*$/m);
      const failMatch = rawOutput.match(/^\s*(\d+)\s+fail\s*$/m);
      const passed = passMatch ? Number(passMatch[1]) : 0;
      const failed = failMatch ? Number(failMatch[1]) : 0;
      resolveRun({
        rel,
        passed,
        failed,
        durationMs: Date.now() - startedAt,
        exitCode: code ?? 0,
        rawOutput,
      });
    });
  });
}

async function runAllInBatches(items: string[]): Promise<FileResult[]> {
  const results: FileResult[] = [];
  for (let i = 0; i < items.length; i += WORKERS) {
    const batch = items.slice(i, i + WORKERS);
    const batchResults = await Promise.all(batch.map(runOneFile));
    results.push(...batchResults);
  }
  return results;
}

const results = await runAllInBatches(files);
results.sort((a, b) => a.rel.localeCompare(b.rel));

const totalPassed = results.reduce((acc, r) => acc + r.passed, 0);
const totalFailed = results.reduce((acc, r) => acc + r.failed, 0);
const failedFiles = results.filter((r) => r.exitCode !== 0);
const ok = failedFiles.length === 0;

console.log('━'.repeat(60));
console.log(`📊 Resumo — ${results.length} arquivo(s) de teste`);
console.log('━'.repeat(60));
for (const r of results) {
  const status = r.exitCode === 0 ? '✅' : '❌';
  const counts =
    r.passed + r.failed > 0 ? `${r.passed} pass / ${r.failed} fail` : 'sem contagem extraída';
  const ms = `${(r.durationMs / 1000).toFixed(2)}s`;
  console.log(`  ${status} ${r.rel.padEnd(50)} ${counts.padEnd(22)} ${ms}`);
}
console.log('━'.repeat(60));
console.log(`Total: ${totalPassed} pass, ${totalFailed} fail em ${results.length} arquivo(s)`);
console.log('━'.repeat(60));

if (!ok) {
  const logDir = resolve(ROOT, '.logs');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const failureLogPath = resolve(logDir, `test-unit-failures-${stamp}.log`);
  const sections = failedFiles.map((r) => {
    const sep = '━'.repeat(60);
    return [
      `${sep}`,
      `❌ ${r.rel}  (exit ${r.exitCode}, ${r.passed} pass / ${r.failed} fail)`,
      sep,
      r.rawOutput.endsWith('\n') ? r.rawOutput : r.rawOutput + '\n',
    ].join('\n');
  });
  await Bun.write(failureLogPath, sections.join('\n'));
  console.log('');
  for (const r of failedFiles) {
    console.log('');
    console.log(`❌ ${r.rel} — output completo:`);
    console.log('─'.repeat(60));
    process.stdout.write(r.rawOutput.endsWith('\n') ? r.rawOutput : r.rawOutput + '\n');
    console.log('─'.repeat(60));
  }
  console.log('');
  console.log(`📄 Log consolidado das falhas salvo em: ${failureLogPath}`);
  process.exit(1);
}

console.log('\n✅ Todos os unit tests passaram');
