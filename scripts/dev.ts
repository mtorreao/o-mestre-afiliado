#!/usr/bin/env bun
/**
 * scripts/dev.ts — dev server multi-processo (API + Worker + Web)
 * =============================================================================
 * Substitui o scripts/dev.sh original com TypeScript nativo Bun.
 *
 * Garantias:
 *   1. PORTA ÚNICA: o backend (API) sobe numa porta só.
 *   2. KILL PREVIOUS: antes de subir, mata qualquer processo segurando
 *      as portas do projeto (API_PORT, WEB_PORT).
 *   3. LOCKFILE: enquanto o dev server está rodando, um lockdir em
 *      tmp/dev-<port>.lockdir existe. Segundo shell aborta com mensagem.
 *   4. LIMPEZA NO EXIT: kill em todos os processos filhos, força com
 *      taskkill /F /T no Windows se necessário, remove lock.
 *   5. LOGS PREFIXADOS: cada processo (api, worker, web) ganha prefixo
 *      colorido em tempo real via TransformStream.
 *   6. Ctrl+C FUNCIONAL: SIGINT é capturado e todos os filhos são mortos.
 *
 * Uso:
 *   bun run scripts/dev.ts                  # HOST=127.0.0.1 API_PORT=5442
 *   API_PORT=8080 bun run scripts/dev.ts    # override da porta
 *   HOST=0.0.0.0  bun run scripts/dev.ts    # expõe na LAN
 *
 * Variáveis de ambiente:
 *   HOST           override do host (default 127.0.0.1)
 *   API_PORT       porta da API (default 5442)
 *   WEB_PORT       porta do Vite (default 5441)
 *   SKIP_LOCK      se setada a 1, não cria lockfile (debug only)
 *   SKIP_WORKER    se setada a 1, não sobe o worker
 *   SKIP_TUNNEL    se setada a 1, não sobe o cloudflared
 *   SKIP_INFRA     se setada a 1, não sobe Docker (PG, Redis, Evolution)
 *   KEEP_INFRA     se setada a 1, mantém containers rodando ao sair (default: derruba)
 * =============================================================================
 */

import { spawn, type Subprocess } from 'bun';
import { mkdir, readFile, writeFile, readdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import * as net from 'net';
import * as path from 'path';

// ═════════════════════════════════════════════════════════════════════════════
// Configuração
// ═════════════════════════════════════════════════════════════════════════════

const HOST = process.env.HOST ?? '127.0.0.1';
const API_PORT = Number(process.env.API_PORT ?? '5442');
const WEB_PORT = Number(process.env.WEB_PORT ?? '5441');
const LOCK_ROOT = process.env.LOCK_ROOT ?? 'tmp';
const SKIP_LOCK = process.env.SKIP_LOCK === '1';
const SKIP_WORKER = process.env.SKIP_WORKER === '1';
const SKIP_TUNNEL = process.env.SKIP_TUNNEL === '1';
const SKIP_INFRA = process.env.SKIP_INFRA === '1';
const KEEP_INFRA = process.env.KEEP_INFRA === '1';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const isWin = process.platform === 'win32';

// Paths específicos Windows
const CLOUDFLARED_BIN = 'cloudflared'; // no PATH do Windows
const CLOUDFLARED_CONFIG = path.join(
  process.env.USERPROFILE ?? process.env.HOME ?? '~',
  '.cloudflared',
  'omestre-afiliado.yml',
);

// Infraestrutura Docker (PostgreSQL, Redis, Evolution API)
const COMPOSE_FILE = path.join(REPO_ROOT, 'docker-compose.infra.yml');
const COMPOSE_ENV_FILE = path.join(REPO_ROOT, '.env.infra');
const INFRA_PROJECT = 'o-mestre-afiliado';

// ═════════════════════════════════════════════════════════════════════════════
// ANSI Colors
// ═════════════════════════════════════════════════════════════════════════════

const colors: Record<string, string> = {
  api: '\x1b[36m',
  worker: '\x1b[33m',
  web: '\x1b[32m',
  tunnel: '\x1b[35m',
  infra: '\x1b[34m',
};
const RESET = '\x1b[0m';

// ═════════════════════════════════════════════════════════════════════════════
// State
// ═════════════════════════════════════════════════════════════════════════════

const processes = new Map<string, Subprocess>();
const readTasks: Promise<void>[] = [];
let lockDir: string | null = null;
let cleanExit = false;
let cleaningUp = false;
let startedInfra = false;

// ═════════════════════════════════════════════════════════════════════════════
// Helpers — portas & processos
// ═════════════════════════════════════════════════════════════════════════════

/** Testa se (host, port) está ocupada via bind(). Confiável e rápido. */
function isPortInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, host);
  });
}

/** Retorna true se existe pelo menos um processo VIVO escutando na porta. */
function portHasLiveProcess(port: number): boolean {
  return pidsOnPort(port).some((pid) => isAlive(pid));
}

/** Retorna PIDs escutando numa porta via netstat. */
function pidsOnPort(port: number): number[] {
  try {
    const out = Bun.spawnSync(['netstat', '-ano']).stdout.toString();
    const re = new RegExp(`\\b${port}\\b.*?LISTENING\\s+(\\d+)`, 'g');
    const pids = new Set<number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(out)) !== null) {
      pids.add(Number(m[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

/** Verifica se um PID está vivo. */
function isAlive(pid: number): boolean {
  if (isWin) {
    const r = Bun.spawnSync(['tasklist', '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
    const t = r.stdout.toString().trim();
    // Quando o processo existe, o CSV contém o PID na 2ª coluna:
    //   "bun.exe","29760","Console",...
    // Quando não existe, retorna mensagem localizada (diferente por idioma):
    //   "INFORMAÇÕES: nenhuma tarefa em execução..." (pt-BR)
    //   "INFO: No tasks are running..." (en-US)
    // Verificar se o PID aparece no output funciona em qualquer idioma.
    return t.includes(String(pid));
  }
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

/** Mata um PID — no Windows força árvore inteira com taskkill. */
function killByPid(pid: number): void {
  console.log(`  ✓ PID ${pid} será morto`);
  if (isWin) {
    Bun.spawnSync(['taskkill', '/F', '/T', '/PID', String(pid)]);
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch { /* already dead */ }
  }
}

/** Retorna o PID pai de um processo no Windows, ou null se não conseguir. */
function getParentPid(pid: number): number | null {
  try {
    // wmic ainda disponível no Windows 10 (deprecated mas funcional)
    const r = Bun.spawnSync([
      'wmic', 'process', 'where', `ProcessId=${pid}`,
      'get', 'ParentProcessId', '/format:csv',
    ], { timeout: 5000 });
    const out = r.stdout.toString().trim();
    // Formato CSV: Node,ParentProcessId\n<hostname>,<ppid>
    const lines = out.split('\n').filter(l => l.includes(','));
    if (lines.length > 0) {
      const ppid = Number(lines[lines.length - 1].split(',')[1]?.trim());
      return isNaN(ppid) || ppid === 0 ? null : ppid;
    }
  } catch { /* wmic indisponível */ }
  return null;
}

/** Mata um PID e, se ele for filho de bun, mata o bun --watch pai também. */
function killByPidWithParent(pid: number): void {
  // PRIMEiro descobre o pai (enquanto o filho ainda está vivo)
  const parentPid = getParentPid(pid);
  let isParentBun = false;
  if (parentPid && isAlive(parentPid)) {
    const tasklist = Bun.spawnSync([
      'tasklist', '/FI', `PID eq ${parentPid}`, '/FO', 'CSV', '/NH',
    ]);
    const name = tasklist.stdout.toString().trim().split(',')[0]?.replace(/"/g, '');
    const img = name?.toLowerCase() ?? '';
    isParentBun = img === 'bun.exe' || img === 'node.exe';
  }

  // Mata o pai primeiro (bun --watch), com taskkill /T que derruba
  // a árvore inteira — assim o pai não consegue restartar o filho.
  if (isParentBun) {
    killByPid(parentPid!);
  }

  // DEPOIS mata o filho (se ainda estiver vivo)
  if (isAlive(pid)) {
    killByPid(pid);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Lock Management
// ═════════════════════════════════════════════════════════════════════════════

async function cleanStaleLocks(): Promise<void> {
  if (!existsSync(LOCK_ROOT)) return;
  const entries = await readdir(LOCK_ROOT, { withFileTypes: true });
  let removed = 0;
  for (const e of entries) {
    if (!e.name.startsWith('dev-') || !e.name.endsWith('.lockdir') || !e.isDirectory()) continue;
    const lp = path.join(LOCK_ROOT, e.name);
    try {
      const pidStr = await readFile(path.join(lp, 'pid'), 'utf-8').catch(() => '');
      const pid = Number(pidStr.trim());
      if (isNaN(pid) || !isAlive(pid)) {
        await rm(lp, { recursive: true, force: true });
        removed++;
      }
    } catch {
      await rm(lp, { recursive: true, force: true });
      removed++;
    }
  }
  if (removed > 0) console.log(`  🧹 ${removed} lock(s) stale removido(s)`);
}

async function acquireLock(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'pid'), String(process.pid));
  await writeFile(path.join(dir, 'host'), HOST);
  await writeFile(path.join(dir, 'apiport'), String(API_PORT));
  lockDir = dir;
}

async function releaseLock(): Promise<void> {
  if (lockDir && existsSync(lockDir)) {
    await rm(lockDir, { recursive: true, force: true }).catch(() => {});
    lockDir = null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Docker Compose — infraestrutura
// ═════════════════════════════════════════════════════════════════════════════

function isDockerAvailable(): boolean {
  try {
    const r = Bun.spawnSync(['docker', '--version'], { timeout: 5000 });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

function composeCmd(args: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync([
    'docker', 'compose',
    '--project-name', INFRA_PROJECT,
    '-f', COMPOSE_FILE,
    '--env-file', COMPOSE_ENV_FILE,
    ...args,
  ], { timeout: 120_000 });
}

function infraIsRunning(): boolean {
  const r = composeCmd(['ps', '--format', 'json']);
  if (r.exitCode !== 0) return false;
  const out = (r.stdout ?? '').toString().trim();
  const lines = out.split('\n').filter(Boolean);
  if (lines.length === 0) return false;

  const expectedServices = new Set(['postgres', 'redis', 'evolution-api']);
  const found = new Set<string>();

  for (const line of lines) {
    try {
      const s = JSON.parse(line);
      if (s.State !== 'running') return false;
      found.add(s.Service as string);
    } catch {
      return false;
    }
  }

  // Garante que todos os serviços esperados estão rodando
  return Array.from(expectedServices).every((s) => found.has(s));
}

async function ensureInfraRunning(): Promise<boolean> {
  if (!isDockerAvailable()) {
    console.log('  ⚠ [infra] Docker não está rodando. Instale Docker Desktop ou use SKIP_INFRA=1');
    return false;
  }

  if (infraIsRunning()) {
    console.log('  ✓ [infra] PostgreSQL, Redis e Evolution API já estão rodando');
    return true;
  }

  console.log('  🚀 [infra] Iniciando PostgreSQL, Redis e Evolution API (docker compose)...');

  // Limpa containers órfãos ou de projetos anteriores que podem conflitar
  // com os container_names do compose atual (ex: omestre_postgres criado
  // por --project-name diferente).
  composeCmd(['down', '--remove-orphans', '--timeout', '5']);

  const up = composeCmd(['up', '-d', '--wait']);

  if (up.exitCode !== 0) {
    const err = (up.stderr ?? '').toString().trim();
    console.error('  ✗ [infra] Falha ao subir infraestrutura:');
    for (const line of err.split('\n')) {
      console.error(`    ${line}`);
    }
    return false;
  }

  console.log('  ✓ [infra] Infraestrutura pronta');
  startedInfra = true;
  return true;
}

function stopInfra(): void {
  console.log('  ⏳ [infra] Derrubando containers...');
  const down = composeCmd(['down', '--timeout', '15']);
  if (down.exitCode === 0) {
    console.log('  ✓ [infra] Containers parados');
  } else {
    const err = (down.stderr ?? '').toString().trim();
    console.log(`  ⚠ [infra] Falha ao derrubar containers: ${err.slice(0, 200)}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Output Streaming — read + prefix
// ═════════════════════════════════════════════════════════════════════════════

function startOutputReader(
  label: string,
  stream: ReadableStream<Uint8Array>,
  isStderr: boolean,
): void {
  const writeFn = isStderr
    ? (s: string) => process.stderr.write(s)
    : (s: string) => process.stdout.write(s);
  const color = colors[label] ?? '';
  const prefix = `  ${color}[${label}]${RESET}`;
  const decoder = new TextDecoder();
  let buf = '';

  // Usa WritableStream em vez de ReadableStreamDefaultReader para que
  // os métodos close()/abort() garantam o flush do buf residual antes
  // da promise do pipeTo() resolver — essencial para logs não aparecerem
  // depois da mensagem de finalização.
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (cleaningUp) return;
      buf += decoder.decode(chunk, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        writeFn(`${prefix} ${line}\n`);
      }
    },
    close() {
      if (!cleaningUp && buf) writeFn(`${prefix} ${buf}\n`);
    },
    abort() {
      if (!cleaningUp && buf) writeFn(`${prefix} ${buf}\n`);
    },
  });

  // pipeTo() resolve DEPOIS que close()/abort() executarem, garantindo
  // que todo o output foi escrito antes da promise ser considerada settled.
  const pipePromise = stream.pipeTo(writable).catch(() => {
    // Rejeição esperada quando o pipe é abortado — já tratamos em abort()
  });

  readTasks.push(pipePromise);
}

function spawnPrefixed(
  label: string,
  cmd: string[],
  opts?: Parameters<typeof spawn>[1],
): Subprocess {
  const proc = spawn(cmd, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  processes.set(label, proc);
  console.log(`  [${label}] PID ${proc.pid}`);
  startOutputReader(label, proc.stdout!, false);
  startOutputReader(label, proc.stderr!, true);
  return proc;
}

// ═════════════════════════════════════════════════════════════════════════════
// Cleanup
// ═════════════════════════════════════════════════════════════════════════════

function terminate(label: string, proc: Subprocess): void {
  if (!proc.pid) return;
  console.log(`  Parando ${label} (PID ${proc.pid})...`);

  if (isWin) {
    // Windows: taskkill /F /T é instantâneo e silencioso — sem prompts
    // Pular proc.kill() porque bun --hot captura SIGTERM e pergunta
    // "Deseja finalizar o arquivo em lotes (S/N)?" em vez de sair.
    Bun.spawnSync(['taskkill', '/F', '/T', '/PID', String(proc.pid)]);
    return;
  }

  // Unix: SIGTERM graceful
  try {
    proc.kill();
  } catch { /* já morreu */ }
}

async function cleanup(exitCode: number): Promise<void> {
  if (cleanExit) return;
  cleanExit = true;
  cleaningUp = true;

  console.log('\n⏳ Parando processos...');

  // 1. Mata todos os filhos (ordem inversa: web → worker → api → tunnel)
  const order = ['web', 'worker', 'tunnel', 'api'];
  for (const label of order) {
    const proc = processes.get(label);
    if (proc && !proc.killed) {
      terminate(label, proc);
    }
  }

  // 2. Aguarda todos os processos realmente encerrarem no SO e os streams
  //    fecharem — sem isso o reader task pode continuar processando buffers
  //    residuais e escrevendo logs DEPOIS da mensagem de finalização.
  await Promise.allSettled(
    Array.from(processes.values()).map((p) => p.exited),
  );
  // Dá um tick extra pro event loop processar o fechamento dos streams
  await new Promise((r) => setImmediate(r));

  // 3. Aguarda as tasks de leitura finalizarem (streams já fecharam,
  //     então os readers resolvem imediatamente com done=true + flush do buf)
  await Promise.allSettled(readTasks);

  // 4. Libera o lock
  await releaseLock();

  // 5. Derruba containers Docker (a menos que KEEP_INFRA=1)
  if (!KEEP_INFRA) {
    stopInfra();
  } else {
    console.log('  [infra] KEEP_INFRA=1, containers mantidos rodando');
  }

  // 6. Verificação final: portas livres?
  const busy: string[] = [];
  for (const port of [API_PORT, WEB_PORT]) {
    if (await portHasLiveProcess(port)) {
      busy.push(`porta ${port}`);
    }
  }
  if (busy.length > 0) {
    console.log(`  ⚠ ${busy.join(', ')} ainda ocupada(s) — forçando taskkill...`);
    for (const port of [API_PORT, WEB_PORT]) {
      for (const pid of pidsOnPort(port)) {
        killByPid(pid);
      }
    }
  }

  console.log('✓ Dev server parou.');
  process.exit(exitCode);
}

// ═════════════════════════════════════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  process.on('SIGINT', () => cleanup(130));
  process.on('SIGTERM', () => cleanup(143));
  process.on('uncaughtException', (err) => {
    console.error('\nErro não capturado:', err);
    cleanup(1);
  });

  // ── 1. Stale locks ──
  await cleanStaleLocks();

  // ── 2. Lock pre-check + auto-kill ──
  const hostSlug = HOST.replace(/[:.]/g, '-');
  const reqLock = path.join(LOCK_ROOT, `dev-${hostSlug}-${API_PORT}.lockdir`);

  if (!SKIP_LOCK && existsSync(reqLock)) {
    const heldPid = await readFile(path.join(reqLock, 'pid'), 'utf-8').catch(() => '');
    const heldPidNum = Number(heldPid.trim());

    if (heldPidNum && isAlive(heldPidNum)) {
      console.log(`  ⚠ Kill automático: dev server anterior (PID ${heldPidNum}) usando ${reqLock}`);
      killByPid(heldPidNum);
    }

    // Remove lock dir (vivo ou stale) — se o kill acima funcionou o cleanup do outro
    // processo pode ter removido, então ignore erro.
    await rm(reqLock, { recursive: true, force: true }).catch(() => {});
    console.log(`  🧹 Lock removido: ${reqLock}`);
  }

  // ── 3. Kill previous processes (portas) ──
  console.log('🧹 Verificando portas ocupadas...');

  let killedAny = false;
  for (const port of [API_PORT, WEB_PORT]) {
    const pids = pidsOnPort(port);
    for (const pid of pids) {
      if (isAlive(pid)) {
        killByPidWithParent(pid);
        killedAny = true;
      }
    }
  }

  if (killedAny) {
    await new Promise((r) => setTimeout(r, 1500));
  }

  // ── 4. Port check final (com retry + kill do pai) ──
  // O kill inicial pode matar só o servidor filho, mas o bun --watch pai
  // sobrevive e restarta o servidor. Se a porta ainda estiver ocupada,
  // sobe na árvore de processos e mata o pai também.
  for (const [port, label] of [[API_PORT, 'API'], [WEB_PORT, 'WEB']] as const) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await portHasLiveProcess(port))) break;

      if (attempt < 2) {
        console.log(`  ⚠ Porta ${port} ainda ocupada (tentativa ${attempt + 2}) — subindo na árvore...`);
        const pids = pidsOnPort(port);
        for (const pid of pids) {
          if (isAlive(pid)) killByPidWithParent(pid);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    if (await portHasLiveProcess(port)) {
      console.error(`✗ Porta ${port} (${label}) continua ocupada após 3 tentativas.`);
      console.error(`  Para debug: netstat -ano | grep :${port}`);
      process.exit(1);
    }
  }
  console.log('✓ Portas livres');

  // ── 5. Infraestrutura Docker ──
  if (!SKIP_INFRA) {
    const infraOk = await ensureInfraRunning();
    if (!infraOk) {
      console.error(`  ⚠ Infraestrutura não disponível. O projeto pode não funcionar corretamente.`);
      console.error(`    Use SKIP_INFRA=1 para pular, ou rode manualmente:`);
      console.error(`    docker compose -f docker-compose.infra.yml --env-file .env.infra up -d`);
    }
  } else {
    console.log('  [infra] SKIP_INFRA=1, não subiu');
  }

  // ── 6. Lock ──
  if (!SKIP_LOCK) {
    await acquireLock(reqLock);
  }

  // ── 7. Banner ──
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║     O Mestre Afiliado — Dev Server              ║');
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  API:    http://${HOST}:${API_PORT}`);
  console.log(`  Web:    http://${HOST}:${WEB_PORT}`);
  console.log(`  Worker: ${SKIP_WORKER ? 'SKIP' : '(background, logs no stdout)'}`);
  console.log(`  Infra:  ${SKIP_INFRA ? 'SKIP' : '(PostgreSQL, Redis, Evolution API)'}`);
  console.log(`  Tunnel: ${SKIP_TUNNEL ? 'SKIP' : 'cloudflared → dev.omestreafiliado.com.br'}`);
  console.log(`  Lock:   ${SKIP_LOCK ? '(SKIP)' : reqLock + ' (PID ' + process.pid + ')'}`);
  console.log('');

  // ── 8. Start processes ──
  process.env.HOST = HOST;
  process.env.API_PORT = String(API_PORT);

  spawnPrefixed('api', ['bun', '--watch', 'apps/api/src/index.ts'], {
    cwd: REPO_ROOT,
  });

  if (!SKIP_WORKER) {
    spawnPrefixed('worker', ['bun', '--watch', 'apps/worker/src/index.ts'], {
      cwd: REPO_ROOT,
    });
  } else {
    console.log('  [worker] SKIP_WORKER=1, não subiu');
  }

  spawnPrefixed('web', ['bun', 'run', 'dev', '--port', String(WEB_PORT), '--host', HOST], {
    cwd: path.join(REPO_ROOT, 'apps/web'),
  });

  if (!SKIP_TUNNEL) {
    spawnPrefixed('tunnel', [CLOUDFLARED_BIN, 'tunnel', '--config', CLOUDFLARED_CONFIG, 'run', 'omestre-afiliado'], {
      cwd: REPO_ROOT,
    });
  } else {
    console.log('  [tunnel] SKIP_TUNNEL=1, não subiu');
  }

  console.log('');
  console.log('─────────────────────────────────────────────────────');
  console.log('  Ctrl-C para parar tudo.');
  console.log('─────────────────────────────────────────────────────');
  console.log('');

  // ── 9. Wait for any process to exit unexpectedly ──
  const exitPromises = Array.from(processes.entries()).map(
    async ([label, proc]) => {
      const code = await proc.exited;
      return { label, code };
    },
  );

  const exited = await Promise.race(exitPromises);
  console.log(`\n⚠ Processo ${exited.label} encerrou (código ${exited.code})`);
  await cleanup(exited.code ?? 1);
}

main().catch((err) => {
  console.error('\nErro fatal:', err);
  cleanup(1);
});
