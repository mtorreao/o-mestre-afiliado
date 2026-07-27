#!/usr/bin/env bun
/**
 * scripts/test-coverage.ts — Mede cobertura de testes unitários em
 * todos os subprojetos, agregando num único relatório.
 *
 * Roda `bun test --coverage` em cada apps/* e packages/* que tenha
 * *.test.ts. Cada subprojeto gera seu próprio .lcov em
 * `<subdir>/coverage/lcov.info`. Consolidamos tudo num relatório
 * agregado com:
 *  - % médio de cobertura (functions, lines, branches)
 *  - tabela por arquivo/módulo (top 20 piores)
 *  - paths uncovered
 *
 * Variáveis de ambiente:
 *  - COVERAGE_REPORTER: 'text' (default), 'lcov', ou 'text+lcov'
 *
 * Uso:
 *   bun run scripts/test-coverage.ts
 */
import { spawn } from 'node:child_process';
import { resolve, join, relative } from 'node:path';
import {
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

const ROOT = resolve(import.meta.dir, '..');
const COVERAGE_DIR = resolve(ROOT, 'coverage');
const REPORTER = process.env.COVERAGE_REPORTER || 'text';

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
  console.log('⚠️  Nenhum subprojeto com *.test.ts encontrado — nada a medir.');
  process.exit(0);
}

// Limpa coverage/ raiz e prepara estrutura
if (existsSync(COVERAGE_DIR)) {
  rmSync(COVERAGE_DIR, { recursive: true, force: true });
}
mkdirSync(COVERAGE_DIR, { recursive: true });

console.log(`📊 Medindo cobertura em ${subprojects.length} subprojeto(s) em paralelo...\n`);

interface SubprojectResult {
  name: string;
  rel: string;
  durationMs: number;
  exitCode: number;
  textSummary: string;
  hasLcov: boolean;
  lcovPath: string;
}

async function runProject(dir: string): Promise<SubprojectResult> {
  const rel = dir.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
  const name = rel.split('/').slice(-2).join('/');
  const startedAt = Date.now();
  const lcovPath = join(dir, 'coverage', 'lcov.info');

  return new Promise((resolveRun) => {
    const child = spawn(
      'bun',
      ['test', '--coverage', '--coverage-reporter=text', '--coverage-reporter=lcov'],
      {
        cwd: dir,
        env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
        shell: process.platform === 'win32',
      },
    );

    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c) => chunks.push(Buffer.from(c)));
    child.stderr?.on('data', (c) => chunks.push(Buffer.from(c)));

    child.on('close', (code) => {
      const rawOutput = Buffer.concat(chunks).toString('utf8');
      const hasLcov = existsSync(lcovPath);
      resolveRun({
        name,
        rel,
        durationMs: Date.now() - startedAt,
        exitCode: code ?? 0,
        textSummary: rawOutput,
        hasLcov: existsSync(lcovPath),
        lcovPath,
      });
      if (!existsSync(lcovPath)) {
        console.warn(`  ⚠️  ${name}: lcov NÃO gerado em ${lcovPath}`);
        console.warn(`  ⚠️  Raw exit: ${code}, dir exists: ${existsSync(dir)}`);
      }
    });
  });
}

const results: SubprojectResult[] = [];
for (const dir of subprojects) {
  const r = await runProject(dir);
  results.push(r);
}
results.sort((a, b) => a.rel.localeCompare(b.rel));

// ─── Consolida lcov se disponível ────────────────────────────────────
interface LcovRecord {
  file: string;
  linesFound: number;
  linesHit: number;
  functionsFound: number;
  functionsHit: number;
  branchesFound: number;
  branchesHit: number;
}

function parseLcov(content: string, baseDir: string): LcovRecord {
  const rec: LcovRecord = {
    file: '',
    linesFound: 0,
    linesHit: 0,
    functionsFound: 0,
    functionsHit: 0,
    branchesFound: 0,
    branchesHit: 0,
  };
  for (const line of content.split('\n')) {
    if (line.startsWith('SF:')) {
      // Normaliza para caminho absoluto. O Bun emite SF: relativo ao
      // cwd do subprojeto (ex: "../../packages/db/..." ou "db/...").
      // Resolver contra o baseDir evita contar o mesmo arquivo físico
      // múltiplas vezes quando é compartilhado entre workspaces.
      rec.file = resolve(baseDir, line.slice(3));
    } else if (line.startsWith('LF:')) rec.linesFound = Number(line.slice(3));
    else if (line.startsWith('LH:')) rec.linesHit = Number(line.slice(3));
    else if (line.startsWith('FNF:')) rec.functionsFound = Number(line.slice(4));
    else if (line.startsWith('FNH:')) rec.functionsHit = Number(line.slice(4));
    else if (line.startsWith('BRF:')) rec.branchesFound = Number(line.slice(4));
    else if (line.startsWith('BRH:')) rec.branchesHit = Number(line.slice(4));
  }
  return rec;
}

const allRecords: LcovRecord[] = [];
for (const r of results) {
  if (r.hasLcov) {
    try {
      const content = readFileSync(r.lcovPath, 'utf-8');
      const baseDir = resolve(ROOT, r.rel);
      // lcov pode ter múltiplos records (separados por 'end_of_record')
      const records = content
        .split('end_of_record')
        .map((chunk) => {
          const trimmed = chunk.trim();
          return trimmed ? parseLcov(trimmed + '\nend_of_record\n', baseDir) : null;
        })
        .filter((x): x is LcovRecord => x !== null && x.file !== '');
      allRecords.push(...records);
    } catch (err) {
      console.warn(`⚠️  Não foi possível ler ${r.lcovPath}: ${err}`);
    }
  }
}

// ─── Deduplicação por arquivo físico ─────────────────────────────────
// Arquivos de workspace compartilhado (ex: @omestre/db) aparecem no lcov
// de CADA subprojeto que os importa, com paths relativos diferentes.
// Para não contar o mesmo arquivo N vezes, mantemos UM record por caminho
// absoluto — o de maior `linesFound` (o subprojeto que mais exercitou
// aquele arquivo, logo a cobertura mais representativa).
const deduped = new Map<string, LcovRecord>();
for (const rec of allRecords) {
  const existing = deduped.get(rec.file);
  // Mantém o record mais representativo para o arquivo físico.
  // Critério: MAIOR taxa de cobertura (linesHit/linesFound), pois um
  // arquivo de workspace compartilhado é coberto de fato pelo subprojeto
  // que o exercita (ex: o pacote `shared` com seus testes dedicados),
  // enquanto subprojetos que só o importam geram records com quase
  // nenhuma linha coberta. Manter "maior linesFound" induziria a suplantar
  // a medição real (341/10 vencendo 256/251). Desempate: maior linesFound.
  const rate = (r: LcovRecord) => (r.linesFound > 0 ? r.linesHit / r.linesFound : -1);
  if (
    !existing ||
    rate(rec) > rate(existing) ||
    (rate(rec) === rate(existing) && rec.linesFound > existing.linesFound)
  ) {
    deduped.set(rec.file, rec);
  }
}
const uniqueRecords = [...deduped.values()];

// ─── Arquivos isentos de cobertura (I/O puro) ──────────────────────────
// Lista de módulos cuja função é EXCLUSIVAMENTE orquestração de I/O
// (conexão Redis, fetch de rede, servidor HTTP, leitura de disco, escrita
// de log, pipeline de streams). Não há lógica de negócio isolável nelas —
// testar exigiria um serviço externo real (Redis/Postgres/Evolution/rede).
// A lógica de decisão ao redor desses módulos vive em `*-pure.ts` (ou em
// funções `export` puras no mesmo arquivo) e é coberta pelos testes.
// Mantemos esses arquivos FORA da métrica agregada para não diluir a
// cobertura real do código de negócio. Veja AGENTS.md → "Cobertura de testes".
const EXCLUDED_FROM_COVERAGE = new Set<string>([
  // apps/ingestor — Redis, fetch de rede, leitura de disco, pipeline
  'apps/ingestor/src/redis.ts',
  'apps/ingestor/src/terms-lists.ts',
  'apps/ingestor/src/metrics.ts',
  'apps/ingestor/src/ingestor.ts',
  'apps/ingestor/src/link-converters.ts',
  'apps/ingestor/src/product-image.ts',
  'apps/ingestor/src/resolve-social-product.ts',
  'apps/ingestor/src/resolve-redirect.ts', // orquestração de fetch de redirects (rede)
  'apps/ingestor/src/conversion-cache.ts',
  'apps/ingestor/src/source-group-cache.ts',
  'apps/ingestor/src/offer-logger.ts',
  // apps/api — fetch de rede (serviços de worker) e proxy DLQ
  'apps/api/src/services/worker-metrics.ts',
  // apps/dispatcher — orquestração do rate limiter (o núcleo é testado)
  // packages/db — bootstrap de conexão (lazy connect ao Postgres)
  'packages/db/src/db.ts',
  // packages/worker-common — Redis e envio de notificações
  'packages/worker-common/src/dead-letter-queue.ts',
  'packages/worker-common/src/notifier.ts',
  'packages/worker-common/src/metrics-server.ts',
  // packages/converters — fetch de rede (conversores de URL)
  'packages/converters/src/amazon.ts',
  'packages/converters/src/shopee.ts',
]);

function isExcluded(absFile: string): boolean {
  const rel = relative(ROOT, absFile).replace(/\\/g, '/');
  return EXCLUDED_FROM_COVERAGE.has(rel);
}

const coveredRecords = uniqueRecords.filter((r) => !isExcluded(r.file));

// ─── Sumariza (métrica ajustada: só código passível de teste) ─────────
let totalLines = 0,
  hitLines = 0;
let totalFuncs = 0,
  hitFuncs = 0;
let totalBranches = 0,
  hitBranches = 0;
for (const rec of coveredRecords) {
  totalLines += rec.linesFound;
  hitLines += rec.linesHit;
  totalFuncs += rec.functionsFound;
  hitFuncs += rec.functionsHit;
  totalBranches += rec.branchesFound;
  hitBranches += rec.branchesHit;
}

const linePct = totalLines > 0 ? (hitLines / totalLines) * 100 : 0;
const funcPct = totalFuncs > 0 ? (hitFuncs / totalFuncs) * 100 : 0;
const branchPct = totalBranches > 0 ? (hitBranches / totalBranches) * 100 : 0;

// ─── Relatório ────────────────────────────────────────────────────────
console.log('━'.repeat(78));
console.log('📊 Cobertura Agregada');
console.log('━'.repeat(78));
console.log(
  `  Funções:  ${hitFuncs.toString().padStart(5)} / ${totalFuncs.toString().padStart(5)}  (${funcPct.toFixed(2)}%)`,
);
console.log(
  `  Linhas:  ${hitLines.toString().padStart(5)} / ${totalLines.toString().padStart(5)}  (${linePct.toFixed(2)}%)`,
);
console.log(
  `  Branches: ${hitBranches.toString().padStart(5)} / ${totalBranches.toString().padStart(5)}  (${branchPct.toFixed(2)}%)`,
);
console.log('━'.repeat(78));

// Tabela por subprojeto
console.log('\n📦 Por subprojeto:');
console.log('-'.repeat(78));
console.log(
  'Subprojeto'.padEnd(34) +
    ' ' +
    'Funções'.padStart(10) +
    ' ' +
    'Linhas'.padStart(10) +
    ' ' +
    'Branches'.padStart(10) +
    ' ' +
    'Tempo'.padStart(8),
);
console.log('-'.repeat(78));
for (const r of results) {
  // Soma só os records deste subprojeto (heurística simples: por path)
  // Como o lcov é um arquivo por subprojeto, podemos acumular
  // por re-parsear. Aqui simplificamos para exibir só a média global
  // do subprojeto (se o bun --coverage text imprime).
  const m = r.textSummary.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  const subFunc = m ? m[1] : '-';
  const subLine = m ? m[2] : '-';
  const ms = `${(r.durationMs / 1000).toFixed(1)}s`;
  console.log(
    r.name.padEnd(34) +
      ' ' +
      (subFunc ?? '-').padStart(8) +
      '% ' +
      (subLine ?? '-').padStart(8) +
      '% ' +
      '-'.padStart(9) +
      ' ' +
      ms.padStart(8),
  );
}
console.log('-'.repeat(78));

// Top 20 piores (menor % de linhas cobertas) — só código passível de teste
const fileStats = coveredRecords
  .filter((r) => r.linesFound > 0)
  .map((r) => ({
    file: r.file,
    pct: (r.linesHit / r.linesFound) * 100,
    lines: r.linesFound,
    hits: r.linesHit,
  }))
  .sort((a, b) => a.pct - b.pct)
  .slice(0, 20);

if (fileStats.length > 0) {
  console.log('\n🔻 Arquivos com menor cobertura (top 20):');
  console.log('-'.repeat(78));
  console.log('Arquivo'.padEnd(60) + ' ' + 'Linhas'.padStart(14) + ' ' + '%'.padStart(7));
  console.log('-'.repeat(78));
  for (const f of fileStats) {
    const rel = relative(ROOT, f.file);
    const shortName = rel.length > 58 ? '...' + rel.slice(-55) : rel;
    console.log(
      shortName.padEnd(60) +
        ' ' +
        `${f.hits}/${f.lines}`.padStart(14) +
        ' ' +
        `${f.pct.toFixed(1)}%`.padStart(7),
    );
  }
  console.log('-'.repeat(78));
}

// Salva relatório consolidado
const reportPath = join(COVERAGE_DIR, 'summary.md');

// Métrica bruta (inclui isentos de I/O puro) para transparência
let rawLines = 0,
  rawHit = 0,
  rawFuncs = 0,
  rawFuncHit = 0;
for (const rec of uniqueRecords) {
  rawLines += rec.linesFound;
  rawHit += rec.linesHit;
  rawFuncs += rec.functionsFound;
  rawFuncHit += rec.functionsHit;
}
const rawLinePct = rawLines > 0 ? (rawHit / rawLines) * 100 : 0;
const rawFuncPct = rawFuncs > 0 ? (rawFuncHit / rawFuncs) * 100 : 0;
const excludedCount = uniqueRecords.length - coveredRecords.length;

let md = `# Cobertura Agregada — O Mestre Afiliado\n\n`;
md += `**Ajustada (só código passível de teste):** **${linePct.toFixed(2)}% linhas**, **${funcPct.toFixed(2)}% funções**\n\n`;
md += `> Bruta (inclui ${excludedCount} arquivo(s) isento(s) de I/O puro): ${rawLinePct.toFixed(2)}% linhas / ${rawFuncPct.toFixed(2)}% funções.\n\n`;
md += `| Métrica | Coberto | Total | % |\n|---|---|---|---|\n`;
md += `| Funções | ${hitFuncs} | ${totalFuncs} | ${funcPct.toFixed(2)}% |\n`;
md += `| Linhas | ${hitLines} | ${totalLines} | ${linePct.toFixed(2)}% |\n`;
md += `| Branches | ${hitBranches} | ${totalBranches} | ${branchPct.toFixed(2)}% |\n\n`;
md += `## Por subprojeto\n\n`;
md += `| Subprojeto | Funções | Linhas | Branches | Tempo |\n|---|---|---|---|---|\n`;
for (const r of results) {
  const m = r.textSummary.match(/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/);
  const subFunc = m ? `${m[1]}%` : '-';
  const subLine = m ? `${m[2]}%` : '-';
  md += `| ${r.name} | ${subFunc} | ${subLine} | - | ${(r.durationMs / 1000).toFixed(1)}s |\n`;
}
if (fileStats.length > 0) {
  md += `\n## Arquivos com menor cobertura (top 20)\n\n`;
  md += `| Arquivo | Linhas | % |\n|---|---|---|\n`;
  for (const f of fileStats) {
    const rel = relative(ROOT, f.file);
    md += `| ${rel} | ${f.hits}/${f.lines} | ${f.pct.toFixed(1)}% |\n`;
  }
}
writeFileSync(reportPath, md, 'utf-8');
console.log(`\n📄 Relatório Markdown salvo em: ${reportPath.replace(ROOT + '/', '')}`);

const failed = results.filter((r) => r.exitCode !== 0);
if (failed.length > 0) {
  console.log(`\n❌ ${failed.length} subprojeto(s) falharam`);
  process.exit(1);
}
