#!/usr/bin/env bun
/**
 * load/loadtest-control.ts — Controla a stack de teste de carga (Bun).
 *
 * Subcomandos:
 *   up [--build]            builda (se --build) e sobe a stack
 *   down [-v]               derruba a stack (-v remove volumes)
 *   status                  mostra containers da stack
 *   logs [service] [-f]     tail dos logs (ex: logs api -f)
 *   wait [--api-url URL]    espera healthcheck da API passar
 *   smoke                   roda o loadtest contra o mock interno
 *   ramp [--stages SPEC]    ramp-up contra a stack loadtest
 *   compare <A> <B>         roda ramp contra 2 targets e imprime tabela
 *   ps                      stats de CPU/mem dos containers
 *
 * Flags:
 *   --api-url URL           override da URL da API (default: http://localhost:5502)
 *   --key VALUE             override da EVOLUTION_API_KEY (le do container api)
 *   --stages SPEC           stages do ramp (conc:seg,conc:seg,...)
 *   --scenario NOME         cenario do loadtest (default: webhook-ingest-burst)
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dir, '..');
const COMPOSE_FILE = process.env.LOADTEST_COMPOSE_FILE
  ? resolve(ROOT, process.env.LOADTEST_COMPOSE_FILE)
  : resolve(ROOT, 'load/docker-compose.loadtest.yml');
const PROJECT = process.env.LOADTEST_PROJECT ?? 'omestre-loadtest';
const DEFAULT_API = 'http://localhost:5502';
const DEFAULT_RAMP_STAGES = '5:10,25:10,50:10,100:10,200:10';
const DEFAULT_SCENARIO = 'webhook-ingest-burst';

type FlagMap = Record<string, string | boolean>;
function parseArgs(argv: string[]): { cmd: string; rest: string[]; flags: FlagMap } {
  const flags: FlagMap = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      rest.push(a);
    }
  }
  return { cmd: rest[0] ?? 'help', rest: rest.slice(1), flags };
}

function compose(args: string[], opts: { cwd?: string; stdio?: 'inherit' | 'pipe' } = {}): string {
  const full = ['docker', 'compose', '-f', COMPOSE_FILE, '-p', PROJECT, ...args];
  const result = spawnSync(full[0]!, full.slice(1), {
    cwd: opts.cwd ?? ROOT,
    stdio: opts.stdio ?? 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, DOCKER_CLI_HINTS: 'false' },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      'compose ' +
        args.join(' ') +
        ' exit ' +
        result.status +
        ': ' +
        (result.stderr ?? result.stdout ?? ''),
    );
  }
  return result.stdout ?? '';
}
function readFlag(flags: FlagMap, name: string, fallback: string): string {
  const v = flags[name];
  return typeof v === 'string' ? v : fallback;
}

function getApiKey(flags: FlagMap): string {
  const v = flags.key;
  if (typeof v === 'string' && v.length > 0) return v;
  const out = spawnSync(
    'docker',
    ['exec', 'omestre_loadtest_api', 'printenv', 'EVOLUTION_API_KEY'],
    { stdio: 'pipe', encoding: 'utf8', shell: process.platform === 'win32' },
  );
  const k = (out.stdout ?? '').trim();
  if (k.length === 0) {
    console.error('Nao foi possivel descobrir a EVOLUTION_API_KEY (use --key VALUE).');
    process.exit(1);
  }
  return k;
}

function checkComposeExists(): void {
  if (!existsSync(COMPOSE_FILE)) {
    console.error('Compose file nao encontrado: ' + COMPOSE_FILE);
    process.exit(1);
  }
}

function cmdUp(flags: FlagMap): void {
  checkComposeExists();
  const build = flags.build === true ? ['--build'] : [];
  console.log('Subindo stack loadtest (project=' + PROJECT + ')...');
  compose(['up', '-d', ...build]);
  console.log('Stack up. Use `bun run load/loadtest-control.ts wait` para aguardar healthchecks.');
}

function cmdDown(flags: FlagMap): void {
  checkComposeExists();
  const vols = flags.v === true ? ['-v'] : [];
  console.log(
    'Derrubando stack loadtest (project=' +
      PROJECT +
      ')' +
      (vols.length ? ' + volumes' : '') +
      '...',
  );
  compose(['down', ...vols]);
  console.log('Stack down.');
}

function cmdStatus(): void {
  checkComposeExists();
  compose(['ps']);
}

function cmdLogs(flags: FlagMap, rest: string[]): void {
  checkComposeExists();
  const svc = rest[0];
  const args = ['logs'];
  if (flags.f === true) args.push('--follow');
  args.push('--tail', '100');
  if (svc) args.push(svc);
  compose(args);
}

async function cmdWait(flags: FlagMap): Promise<void> {
  const url = readFlag(flags, 'api-url', DEFAULT_API) + '/health';
  const maxAttempts = Number((flags['max-attempts'] as string) ?? 60);
  const intervalMs = Number((flags['interval-ms'] as string) ?? 2000);
  console.log(
    'Aguardando ' + url + ' ficar OK (ate ' + maxAttempts + ' tentativas, ' + intervalMs + 'ms)...',
  );
  for (let i = 1; i <= maxAttempts; i++) {
    const res = spawnSync(
      'curl',
      ['-sS', '-m', '3', '-o', '/dev/null', '-w', '%{http_code}', url],
      {
        stdio: 'pipe',
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );
    const code = (res.stdout ?? '').trim();
    if (code === '200' || code === '204') {
      console.log('Healthcheck OK apos ' + i + ' tentativa(s) (HTTP ' + code + ').');
      return;
    }
    if (i % 5 === 0) {
      console.log(
        '  [' +
          i +
          '/' +
          maxAttempts +
          '] ainda nao pronto (HTTP ' +
          (code || 'no response') +
          ')...',
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  console.error('Healthcheck NAO passou em ' + maxAttempts + ' tentativas.');
  process.exit(1);
}
function runLoadtest(flags: FlagMap, target: string): { code: number; stdout: string } {
  const key = getApiKey(flags);
  const scenario = readFlag(flags, 'scenario', DEFAULT_SCENARIO);
  const stages = readFlag(flags, 'stages', DEFAULT_RAMP_STAGES);
  const ramp = flags.ramp === true || !!flags.stages || (flags.mode as string) === 'ramp';
  const args = ['run', '--cwd', 'apps/loadtest', 'src/index.ts'];
  if (flags.mock === true) args.push('--mock');
  args.push(ramp ? '--ramp' : '--all', '--target', target, '--key', key, '--scenario', scenario);
  if (ramp) args.push('--stages', stages);
  console.log(
    (ramp ? 'ramp' : 'all') +
      ' contra ' +
      target +
      ' (scenario=' +
      scenario +
      (ramp ? ', stages=' + stages : '') +
      ')...',
  );
  const res = spawnSync('bun', args, {
    cwd: ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    env: { ...process.env, EVOLUTION_API_URL: '' },
    encoding: 'utf8',
  });
  const stdout = (res.stdout ?? '') + (res.stderr ?? '');
  return { code: res.status ?? 0, stdout };
}

function cmdSmoke(flags: FlagMap): void {
  const out = runLoadtest({ ...flags, mock: true, key: 'test-key' }, 'http://localhost:5599');
  console.log(out.stdout);
  if (out.code !== 0) process.exit(out.code);
}

function cmdRamp(flags: FlagMap): void {
  const target = readFlag(flags, 'api-url', DEFAULT_API);
  const out = runLoadtest(flags, target);
  console.log(out.stdout);
  if (out.code !== 0) process.exit(out.code);
}

interface StageRow {
  stage: number;
  conc: number;
  rps: number;
  p50: number;
  p95: number;
  p99: number;
  fivexx: number;
  err: number;
  slo: 'OK' | 'FAIL' | '-';
}

function parseRampReport(stdout: string): {
  rows: StageRow[];
  saturation: number | null;
  capacity: number | null;
  breachedAt: number | null;
} {
  const rows: StageRow[] = [];
  let saturation: number | null = null;
  let capacity: number | null = null;
  let breachedAt: number | null = null;
  for (const line of stdout.split('\n')) {
    const m = line.match(
      /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\S+)/,
    );
    if (m) {
      rows.push({
        stage: Number(m[1]),
        conc: Number(m[2]),
        rps: Number(m[3]),
        p50: Number(m[4]),
        p95: Number(m[5]),
        p99: Number(m[6]),
        fivexx: Number(m[7]),
        err: Number(m[8]),
        slo: m[9] as StageRow['slo'],
      });
      continue;
    }
    const sat = line.match(/Satura..o detectada em conc (\d+)/);
    if (sat) saturation = Number(sat[1]);
    const cap = line.match(/Capacidade estimada:\s*(\d+)\s*req\/s/);
    if (cap) capacity = Number(cap[1]);
    const br = line.match(/SLO rompido no estagio (\d+)/);
    if (br) breachedAt = Number(br[1]);
  }
  return { rows, saturation, capacity, breachedAt };
}

function pad(s: string | number, w: number): string {
  return String(s).padStart(w);
}
function printCompareTable(
  labelA: string,
  resA: {
    rows: StageRow[];
    saturation: number | null;
    capacity: number | null;
    breachedAt: number | null;
  },
  labelB: string,
  resB: {
    rows: StageRow[];
    saturation: number | null;
    capacity: number | null;
    breachedAt: number | null;
  },
): void {
  const concs = Array.from(
    new Set([...resA.rows.map((r) => r.conc), ...resB.rows.map((r) => r.conc)]),
  ).sort((a, b) => a - b);
  console.log('');
  console.log('==== Compare ============================================================');
  console.log('  ' + labelA + '  vs  ' + labelB);
  console.log('-------------------------------------------------------------------------');
  console.log('  conc |   rps A (p50/p95/p99)   |   rps B (p50/p95/p99)   |   delta');
  for (const c of concs) {
    const a = resA.rows.find((r) => r.conc === c);
    const b = resB.rows.find((r) => r.conc === c);
    if (!a || !b) continue;
    const aStr =
      pad(a.rps, 5) + ' (' + pad(a.p50, 3) + '/' + pad(a.p95, 4) + '/' + pad(a.p99, 4) + ')';
    const bStr = pad(b.rps, 5) + ' (' + pad(b.p50, 3) + '/' + pad(b.p95, 4) + ')';
    const deltaPct = a.rps > 0 ? (((b.rps - a.rps) / a.rps) * 100).toFixed(1) : 'n/a';
    console.log(
      '  ' +
        pad(c, 4) +
        ' | ' +
        aStr.padEnd(22) +
        ' | ' +
        bStr.padEnd(22) +
        ' | ' +
        pad(deltaPct + '%', 7),
    );
  }
  console.log('-------------------------------------------------------------------------');
  console.log(
    '  A saturacao: ' +
      (resA.saturation ?? 'nao detectada') +
      '  (capacidade: ' +
      (resA.capacity ?? '-') +
      ' rps)',
  );
  console.log(
    '  B saturacao: ' +
      (resB.saturation ?? 'nao detectada') +
      '  (capacidade: ' +
      (resB.capacity ?? '-') +
      ' rps)',
  );
  console.log('  SLO breach:  A=' + (resA.breachedAt ?? 'ok') + '  B=' + (resB.breachedAt ?? 'ok'));
  console.log('=========================================================================');
}

async function cmdCompare(flags: FlagMap, rest: string[]): Promise<void> {
  const a = rest[0];
  const b = rest[1];
  if (!a || !b) {
    console.error('Uso: compare <targetA> <targetB>  (URLs ou host:porta)');
    process.exit(1);
  }
  const normalize = (u: string) => (/^https?:\/\//.test(u) ? u : 'http://' + u);
  const aUrl = normalize(a);
  const bUrl = normalize(b);
  console.log('Rodando ramp contra A=' + aUrl + '...');
  const resA = runLoadtest(flags, aUrl);
  console.log(resA.stdout);
  if (resA.code === 2) console.warn('(A teve SLO reprovado - segue para B)');
  console.log('Rodando ramp contra B=' + bUrl + '...');
  const resB = runLoadtest(flags, bUrl);
  console.log(resB.stdout);
  const parsedA = parseRampReport(resA.stdout);
  const parsedB = parseRampReport(resB.stdout);
  printCompareTable(a, parsedA, b, parsedB);
  if (resA.code !== 0 && resA.code !== 2) process.exit(resA.code);
  if (resB.code !== 0 && resB.code !== 2) process.exit(resB.code);
}

function cmdPs(): void {
  const res = spawnSync(
    'docker',
    [
      'stats',
      '--no-stream',
      '--format',
      'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}',
    ],
    { stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
}
function printHelp(): void {
  console.log('Uso: bun run load/loadtest-control.ts <comando> [flags]');
  console.log('');
  console.log('Comandos:');
  console.log('  up [--build]            builda (se --build) e sobe a stack loadtest');
  console.log('  down [-v]               derruba a stack (-v remove volumes)');
  console.log('  status                  mostra containers da stack');
  console.log('  logs [service] [-f]     tail dos logs (ex: logs api -f)');
  console.log('  wait [--api-url URL]    espera healthcheck da API passar');
  console.log('  smoke                   roda o loadtest contra o mock interno');
  console.log('  ramp [--stages SPEC]    ramp-up contra a stack loadtest');
  console.log('  compare <A> <B>         roda ramp contra 2 targets e imprime comparacao');
  console.log('  ps                      stats de CPU/mem dos containers (docker stats)');
  console.log('');
  console.log('Variaveis:');
  console.log('  LOADTEST_COMPOSE_FILE   default: load/docker-compose.loadtest.yml');
  console.log('  LOADTEST_PROJECT        default: omestre-loadtest');
  console.log('');
  console.log('Exemplos:');
  console.log('  bun run load/loadtest-control.ts up --build');
  console.log('  bun run load/loadtest-control.ts wait');
  console.log('  bun run load/loadtest-control.ts ramp --stages "5:10,25:10,50:10,100:10,200:10"');
  console.log('  bun run load/loadtest-control.ts compare http://baseline:5502 http://new:5502');
  console.log('  bun run load/loadtest-control.ts down -v');
}

async function main(): Promise<void> {
  const { cmd, rest, flags } = parseArgs(process.argv.slice(2));
  switch (cmd) {
    case 'up':
      return cmdUp(flags);
    case 'down':
      return cmdDown(flags);
    case 'status':
      return cmdStatus();
    case 'logs':
      return cmdLogs(flags, rest);
    case 'wait':
      return cmdWait(flags);
    case 'smoke':
      return cmdSmoke(flags);
    case 'ramp':
      return cmdRamp(flags);
    case 'compare':
      return cmdCompare(flags, rest);
    case 'ps':
      return cmdPs();
    case 'help':
    case '-h':
    case '--help':
    default:
      printHelp();
      if (cmd !== 'help' && cmd !== '-h' && cmd !== '--help') {
        console.error('Comando desconhecido: ' + cmd);
        process.exit(1);
      }
  }
}

main().catch((err) => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
