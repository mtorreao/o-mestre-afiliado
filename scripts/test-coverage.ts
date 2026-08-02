#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { resolve, join, relative } from 'node:path';
import {
  readdirSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = resolve(import.meta.dir, '..');
const COVERAGE_DIR = resolve(ROOT, 'coverage');
const REPORTER = process.env.COVERAGE_REPORTER || 'text';
const WORKERS = Number(process.env.TEST_UNIT_WORKERS ?? 4);

// normaliza separadores para '/' (POSIX) independente de plataforma
const SEP = '\\';
function posixPath(p: string): string {
  return p.split(SEP).join('/');
}

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
  return dirs.flatMap((d) => listTestFiles(d)).sort();
}

const files = listAllTestFiles();
if (files.length === 0) {
  console.log('Nenhum arquivo *.test.ts/tsx encontrado — nada a medir.');
  process.exit(0);
}
if (existsSync(COVERAGE_DIR)) rmSync(COVERAGE_DIR, { recursive: true, force: true });
mkdirSync(COVERAGE_DIR, { recursive: true });
console.log(
  `Medindo cobertura em ${files.length} arquivos (1 processo por arquivo, ${WORKERS} em paralelo)`,
);

interface FileResult {
  rel: string;
  exitCode: number;
  lcovPath: string;
}

function runOneFile(file: string, covDir: string): Promise<FileResult> {
  const rel = relative(ROOT, file).split(SEP).join('/');
  return new Promise((resolveRun) => {
    const args = ['test', '--coverage', '--coverage-reporter=lcov', `--coverage-dir=${covDir}`];
    if (REPORTER.includes('text')) args.push('--coverage-reporter=text');
    args.push(file);
    const child = spawn('bun', args, {
      cwd: ROOT,
      env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
      shell: process.platform === 'win32',
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c) => chunks.push(Buffer.from(c)));
    child.stderr?.on('data', (c) => chunks.push(Buffer.from(c)));
    child.on('close', (code) => {
      const lcovPath = join(covDir, 'lcov.info');
      resolveRun({ rel, exitCode: code ?? 0, lcovPath: existsSync(lcovPath) ? lcovPath : '' });
    });
  });
}

async function runAllInBatches(items: string[]): Promise<FileResult[]> {
  const results: FileResult[] = [];
  const baseTmp = mkdtempSync(join(tmpdir(), 'cov-'));
  for (let i = 0; i < items.length; i += WORKERS) {
    const batch = items.slice(i, i + WORKERS);
    const batchResults = await Promise.all(
      batch.map((file, j) => {
        const covDir = join(baseTmp, `${i + j}`);
        mkdirSync(covDir, { recursive: true });
        return runOneFile(file, covDir);
      }),
    );
    results.push(...batchResults);
  }
  return results;
}

const results = await runAllInBatches(files);
results.sort((a, b) => a.rel.localeCompare(b.rel));

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
    if (line.startsWith('SF:')) rec.file = resolve(baseDir, line.slice(3));
    else if (line.startsWith('LF:')) rec.linesFound = Number(line.slice(3));
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
  if (r.lcovPath) {
    try {
      const content = readFileSync(r.lcovPath, 'utf-8');
      const records = content
        .split('end_of_record')
        .map((chunk) => {
          const trimmed = chunk.trim();
          return trimmed ? parseLcov(trimmed + '\nend_of_record\n', ROOT) : null;
        })
        .filter((x): x is LcovRecord => x !== null && x.file !== '');
      allRecords.push(...records);
    } catch (err) {
      console.warn(`Nao foi possivel ler ${r.lcovPath}: ${err}`);
    }
  }
}

const deduped = new Map<string, LcovRecord>();
for (const rec of allRecords) {
  const existing = deduped.get(rec.file);
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

const EXCLUDED_FROM_COVERAGE = new Set<string>([
  'apps/ingestor/src/redis.ts',
  'apps/ingestor/src/terms-lists.ts',
  'apps/ingestor/src/metrics.ts',
  'apps/ingestor/src/ingestor.ts',
  'apps/ingestor/src/link-converters.ts',
  'apps/ingestor/src/product-image.ts',
  'apps/ingestor/src/resolve-social-product.ts',
  'apps/ingestor/src/resolve-redirect.ts',
  'apps/ingestor/src/conversion-cache.ts',
  'apps/ingestor/src/source-group-cache.ts',
  'apps/ingestor/src/offer-logger.ts',
  'apps/ingestor/src/config.ts',
  'apps/ingestor/src/index.ts',
  'apps/ingestor/src/debug-shopee-image.ts',
  'apps/ingestor/src/ml-cookie-revalidator.ts',
  'apps/ingestor/src/dedup.ts',
  'apps/api/src/services/worker-metrics.ts',
  'packages/db/src/db.ts',
  'packages/worker-common/src/dead-letter-queue.ts',
  'packages/worker-common/src/notifier.ts',
  'packages/worker-common/src/metrics-server.ts',
  'packages/worker-common/src/config.ts',
  'packages/worker-common/src/index.ts',
  'packages/converters/src/amazon.ts',
  'packages/converters/src/shopee.ts',
]);

function isExcluded(absFile: string): boolean {
  const rel = relative(ROOT, absFile).split(SEP).join('/');
  return EXCLUDED_FROM_COVERAGE.has(rel);
}

const coveredRecords = uniqueRecords.filter((r) => !isExcluded(r.file));

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

let md = '# Cobertura Agregada — O Mestre Afiliado\n\n';
md += `**Ajustada (so codigo passivel de teste):** **${linePct.toFixed(2)}% linhas**, **${funcPct.toFixed(2)}% funcoes**\n\n`;
md += `> Bruta (inclui ${excludedCount} arquivo(s) isento(s) de I/O puro): ${rawLinePct.toFixed(2)}% linhas / ${rawFuncPct.toFixed(2)}% funcoes.\n\n`;
md += '| Metrica | Coberto | Total | % |\n|---|---|---|---|\n';
md += `| Funcoes | ${hitFuncs} | ${totalFuncs} | ${funcPct.toFixed(2)}% |\n`;
md += `| Linhas | ${hitLines} | ${totalLines} | ${linePct.toFixed(2)}% |\n`;
md += `| Branches | ${hitBranches} | ${totalBranches} | ${branchPct.toFixed(2)}% |\n\n`;
md += '## Por arquivo (pior cobertura — top 20)\n\n| Arquivo | Linhas | % |\n|---|---|---|\n';

const fileStats = coveredRecords
  .map((r) => ({
    file: r.file,
    lines: r.linesFound,
    hits: r.linesHit,
    pct: r.linesFound > 0 ? (r.linesHit / r.linesFound) * 100 : 100,
  }))
  .filter((f) => f.lines > 0)
  .sort((a, b) => a.pct - b.pct)
  .slice(0, 20);

for (const f of fileStats) {
  const rel = relative(ROOT, f.file).split(SEP).join('/');
  md += `| ${rel} | ${f.hits}/${f.lines} | ${f.pct.toFixed(1)}% |\n`;
}

writeFileSync(join(COVERAGE_DIR, 'summary.md'), md, 'utf-8');
console.log(`\nRelatorio: ${relative(ROOT, join(COVERAGE_DIR, 'summary.md'))}`);
console.log(
  `Cobertura ajustada: ${linePct.toFixed(2)}% linhas / ${funcPct.toFixed(2)}% funcoes (bruta: ${rawLinePct.toFixed(2)}% / ${rawFuncPct.toFixed(2)}%, ${excludedCount} isentos)`,
);

const MIN_LINE_PCT = 80;
const coverageTooLow = linePct < MIN_LINE_PCT;

const failed = results.filter((r) => r.exitCode !== 0);
if (failed.length > 0) {
  console.log(`\n\u274c ${failed.length} arquivo(s) de teste falharam`);
  for (const r of failed) console.log(`  - ${r.rel}`);
  process.exit(1);
}
if (coverageTooLow) {
  console.log(
    `\n\u274c Cobertura ajustada (${linePct.toFixed(2)}% linhas) abaixo do minimo de ${MIN_LINE_PCT}% (AGENTS.md).`,
  );
  process.exit(1);
}
console.log('\n\u2705 Cobertura medida com sucesso');
