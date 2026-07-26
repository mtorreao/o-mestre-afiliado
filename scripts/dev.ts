#!/usr/bin/env bun
/**
 * Sobe a stack completa de desenvolvimento em Docker, isolada por worktree.
 *
 * Cada worktree recebe:
 *   - um Compose project name próprio;
 *   - nomes próprios para containers, network e volumes;
 *   - um bloco de portas livre e determinístico;
 *   - (opcional, opt-in via DEV_TUNNEL=1) um tunnel Cloudflare próprio (nomeado ou quick).
 *
 * Uso:
 *   bun run dev                           # sobe só a stack local (sem tunnel)
 *   DEV_TUNNEL=1 bun run dev              # OPT-IN: sobe também o tunnel Cloudflare
 *   DEV_TUNNEL=1 DEV_TUNNEL_MODE=quick bun run dev   # tunnel anônimo
 *   DEV_TUNNEL=1 DEV_TUNNEL_MODE=named bun run dev   # tunnel nomeado da branch
 *   DEV_PORT_BASE=6000 bun run dev
 *   KEEP_INFRA=1 bun run dev              # mantém os containers após Ctrl+C
 *   DEV_BUILD=0 bun run dev               # não força rebuild das imagens
 *   bun scripts/dev.ts --dry-run          # mostra a configuração sem iniciar Docker
 *
 * Por padrão o tunnel NÃO sobe (apenas a stack local em http://localhost:<porta>).
 * O service `tunnel` continua definido em docker-compose.dev.yml (sob o profile
 * `tunnel`) caso queira subir manualmente com `docker compose --profile tunnel up`.
 *
 * DNS do tunnel nomeado não é alterado por padrão. Configure o CNAME no
 * dashboard Cloudflare ou informe CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID
 * da conta que possui a zona. O token precisa apenas de Zone / DNS / Edit.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';
const requestedDryRun = process.argv.includes('--dry-run');
const isExplicitPortBase = Boolean(process.env.DEV_PORT_BASE);
const bindHost = process.env.DEV_BIND_HOST ?? '127.0.0.1';
// Por padrão NÃO subimos o tunnel (usa só a stack local em http://localhost).
// Opt-in explícito via DEV_TUNNEL=1 para subir o tunnel Cloudflare (profile `tunnel`
// do docker-compose.dev.yml). Todo o código de tunnel permanece no script; o service
// `tunnel` fica definido no compose para uso manual/opt-in.
const enableTunnel = process.env.DEV_TUNNEL === '1';
const skipTunnel = !enableTunnel;
const keepStack = process.env.KEEP_INFRA === '1';
const buildImages = process.env.DEV_BUILD !== '0';
const skipLock = process.env.SKIP_LOCK === '1';
const tunnelDomain = process.env.TUNNEL_DOMAIN ?? 'omestreafiliado.com.br';
const cloudflaredBin = process.env.CLOUDFLARED_BIN ?? 'cloudflared';
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const cloudflareZoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();

const HOME = process.env.USERPROFILE ?? process.env.HOME ?? '~';
const NAMED_TUNNEL_HINTS = [
  process.env.TUNNEL_CONFIG,
  process.env.TUNNEL_ID ? path.join(HOME, '.cloudflared', 'omestre-afiliado.yml') : undefined,
  path.join(HOME, '.cloudflared', 'omestre-afiliado.yml'),
  path.join(HOME, '.cloudflared', 'omestre-afiliado-min.yml'),
  path.join(HOME, '.cloudflared', 'omestre-afiliado-simple.yml'),
].filter(Boolean) as string[];
const hasReliableTunnelConfig = NAMED_TUNNEL_HINTS.some((candidate) => existsSync(candidate));

// Modo do tunnel: 'named' (default), 'quick' (trycloudflare), 'named' ou 'off'.
// Em main (sem GIT_WORKTREE) usamos o tunnel nomeado. Em worktrees secundários
// preferimos o quick tunnel para evitar resetar o CNAME do domínio principal.
const tunnelMode = (process.env.DEV_TUNNEL_MODE
  ?? (process.env.GIT_WORKTREE === undefined ? 'named' : 'quick')
).toLowerCase();

const composeFile = path.join(REPO_ROOT, 'docker-compose.dev.yml');
const lockRoot = path.resolve(REPO_ROOT, process.env.LOCK_ROOT ?? 'tmp');

let lockDir: string | null = null;
let stateFile: string | null = null;
let tunnelConfigPath: string | null = null;
let quickTunnelUrl: string | null = null;
let cleanExit = false;
let stackStarted = false;
let currentPorts: PortMap | null = null;
let tunnelProfileEnabled = false;

const services = ['postgres', 'redis', 'evolution-api', 'api', 'ingestor', 'dispatcher', 'web'];

type PortMap = {
  web: number;
  api: number;
  postgres: number;
  evolution: number;
  redis: number;
  ingestor: number;
  dispatcher: number;
};

type PersistedState = {
  branch: string;
  worktreePath: string;
  worktreeName: string;
  slug: string;
  composeProject: string;
  tunnelMode: string;
  ports: PortMap;
};

function text(value: Uint8Array | string | undefined): string {
  return value === undefined ? '' : value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value);
}

function runGit(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  });
  if (result.exitCode !== 0) {
    throw new Error(`Falha ao executar git ${args.join(' ')}: ${text(result.stderr).trim()}`);
  }
  return text(result.stdout).trim();
}

function findMainWorktree(): string | null {
  const porcelain = runGit(['worktree', 'list', '--porcelain']);
  const blocks = porcelain.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const worktree = block.match(/^worktree (.+)$/m)?.[1];
    const branch = block.match(/^branch refs\/heads\/(.+)$/m)?.[1];
    if (worktree && branch === 'main') return worktree;
  }
  return null;
}

const worktreePath = runGit(['rev-parse', '--show-toplevel']) || REPO_ROOT;
const branch = runGit(['branch', '--show-current']) || `detached-${runGit(['rev-parse', '--short', 'HEAD']) || 'head'}`;
const worktreeName = process.env.WORKTREE_NAME ?? path.basename(worktreePath);

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 35);
  return slug || `worktree-${hashString(worktreePath).toString(36)}`;
}

const slug = slugify(branch);
const identityHash = hashString(`${worktreePath}|${branch}`);
const composeProject = `omestre-dev-${slug}`;
const containerPrefix = `omestre_dev_${slug}`;
const networkName = `omestre-dev-${slug}-net`;
const tunnelName = process.env.TUNNEL_NAME ?? `omestre-afiliado-${slug}`;
const tunnelHostname = process.env.TUNNEL_HOSTNAME ?? `dev-${slug}.${tunnelDomain}`;
const appEnvFile = process.env.DEV_APP_ENV_FILE
  ?? (existsSync(path.join(worktreePath, '.env'))
    ? path.join(worktreePath, '.env')
    : path.join(findMainWorktree() ?? REPO_ROOT, '.env'));
const composeEnvFile = process.env.DEV_COMPOSE_ENV_FILE
  ?? (existsSync(path.join(worktreePath, '.env')) ? path.join(worktreePath, '.env') : undefined);
const statePath = path.join(lockRoot, `dev-${slug}.json`);

function portMap(base: number): PortMap {
  return {
    web: base + 1,
    api: base + 2,
    postgres: base + 3,
    evolution: base + 4,
    redis: base + 5,
    ingestor: base + 6,
    dispatcher: base + 7,
  };
}

function allPorts(ports: PortMap): number[] {
  return Object.values(ports);
}

function isPortInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    const finish = (value: boolean) => {
      server.removeAllListeners();
      if (server.listening) server.close();
      resolve(value);
    };
    server.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'EADDRINUSE'));
    server.once('listening', () => finish(false));
    server.listen(port, host);
  });
}

async function isPortFree(port: number): Promise<boolean> {
  if (await isPortInUse(bindHost, port)) return false;
  if (bindHost !== '::1' && bindHost !== '0.0.0.0' && await isPortInUse('::1', port)) return false;
  return true;
}

async function isBlockFree(ports: PortMap): Promise<boolean> {
  const results = await Promise.all(allPorts(ports).map((port) => isPortFree(port)));
  return results.every(Boolean);
}

function readPersistedState(): PersistedState | null {
  try {
    if (!existsSync(statePath)) return null;
    const parsed = JSON.parse(readFileSync(statePath, 'utf8')) as PersistedState;
    if (
      parsed.slug !== slug ||
      parsed.composeProject !== composeProject ||
      parsed.tunnelMode !== tunnelMode ||
      !parsed.ports ||
      allPorts(parsed.ports).some((port) => !Number.isInteger(port))
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

function tunnelPublicUrl(): string {
  if (quickTunnelUrl) return quickTunnelUrl;
  if (tunnelMode === 'quick') return '(aguardando cloudflared emitir a URL)';
  return `https://${tunnelHostname}`;
}

function composeEnvironment(ports: PortMap): void {
  const portEnv = {
    DEV_WEB_HOST_PORT: `${bindHost}:${ports.web}:5441`,
    DEV_API_HOST_PORT: `${bindHost}:${ports.api}:5442`,
    DEV_POSTGRES_HOST_PORT: `${bindHost}:${ports.postgres}:5432`,
    DEV_EVOLUTION_HOST_PORT: `${bindHost}:${ports.evolution}:8080`,
    DEV_REDIS_HOST_PORT: `${bindHost}:${ports.redis}:6379`,
    DEV_INGESTOR_HOST_PORT: `${bindHost}:${ports.ingestor}:9092`,
    DEV_DISPATCHER_HOST_PORT: `${bindHost}:${ports.dispatcher}:9093`,
  };
  const publicUrl = tunnelPublicUrl();
  const values: Record<string, string> = {
    DEV_COMPOSE_PROJECT: composeProject,
    DEV_CONTAINER_PREFIX: containerPrefix,
    DEV_NETWORK_NAME: networkName,
    DEV_POSTGRES_VOLUME_NAME: `${containerPrefix}-postgres-data`,
    DEV_REDIS_VOLUME_NAME: `${containerPrefix}-redis-data`,
    DEV_EVOLUTION_VOLUME_NAME: `${containerPrefix}-evolution-instances`,
    DEV_APP_ENV_FILE: appEnvFile,
    DEV_CACHE_PREFIX: `evolution_${slug}`,
    DEV_DATABASE_CLIENT_NAME: `omestre_afiliado_${slug}`,
    FRONTEND_URL: process.env.DEV_FRONTEND_URL ?? (skipTunnel ? `http://localhost:${ports.web}` : publicUrl),
    ML_REDIRECT_URI: process.env.DEV_ML_REDIRECT_URI
      ?? (skipTunnel ? `http://localhost:${ports.web}/api/ml/callback` : `${publicUrl}/api/ml/callback`),
    DEV_TUNNEL_HOSTNAME: tunnelHostname,
    DEV_TUNNEL_PUBLIC_URL: publicUrl,
    ...portEnv,
  };
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
  currentPorts = ports;
}

function composeArgs(args: string[], includeTunnel = tunnelProfileEnabled): string[] {
  const result = ['docker', 'compose', '--project-name', composeProject];
  if (includeTunnel) result.push('--profile', 'tunnel');
  if (composeEnvFile && existsSync(composeEnvFile)) result.push('--env-file', composeEnvFile);
  result.push('-f', composeFile, ...args);
  return result;
}

function compose(
  args: string[],
  capture = false,
  includeTunnel = tunnelProfileEnabled,
): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(composeArgs(args, includeTunnel), {
    cwd: REPO_ROOT,
    env: process.env,
    stdin: 'ignore',
    stdout: capture ? 'pipe' : 'inherit',
    stderr: capture ? 'pipe' : 'inherit',
    timeout: 600_000,
  });
  return { exitCode: result.exitCode, stdout: text(result.stdout), stderr: text(result.stderr) };
}

function stackIsRunning(): boolean {
  const result = compose(['ps', '--status', 'running', '--services'], true, false);
  if (result.exitCode !== 0) return false;
  const found = new Set(result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  return services.every((service) => found.has(service));
}

async function choosePorts(): Promise<PortMap> {
  const persisted = readPersistedState();
  if (persisted) {
    composeEnvironment(persisted.ports);
    if (requestedDryRun || stackIsRunning()) {
      if (!requestedDryRun) console.log(`  ✓ Stack existente reutilizada: ${composeProject}`);
      return persisted.ports;
    }
  }

  const configuredBase = Number(process.env.DEV_PORT_BASE ?? '5450');
  if (!Number.isInteger(configuredBase) || configuredBase < 1024 || configuredBase > 64000) {
    throw new Error('DEV_PORT_BASE precisa ser uma porta base entre 1024 e 64000.');
  }

  const firstBase = isExplicitPortBase
    ? configuredBase
    : configuredBase + (identityHash % 40) * 10;
  const attempts = isExplicitPortBase ? 1 : 80;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const base = firstBase + attempt * 10;
    const ports = portMap(base);
    if (allPorts(ports).some((port) => port > 65535)) continue;
    if (await isBlockFree(ports)) return ports;
  }

  const suffix = isExplicitPortBase ? ` em DEV_PORT_BASE=${configuredBase}` : '';
  throw new Error(`Não encontrei um bloco de 7 portas livres${suffix}. Outra stack pode estar usando as portas candidatas.`);
}

async function persistState(ports: PortMap): Promise<void> {
  await mkdir(lockRoot, { recursive: true });
  stateFile = statePath;
  const state: PersistedState = {
    branch,
    worktreePath,
    worktreeName,
    slug,
    composeProject,
    tunnelMode,
    ports,
  };
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

function processIsAlive(pid: number): boolean {
  if (isWindows) {
    const result = Bun.spawnSync(['tasklist', '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return false;
  }
  try {
    return process.kill(pid, 0);
  } catch {
    return false;
  }
}

async function cleanStaleLocks(): Promise<void> {
  if (!existsSync(lockRoot)) return;
  const entries = await readdir(lockRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('dev-') || !entry.name.endsWith('.lockdir')) continue;
    const directory = path.join(lockRoot, entry.name);
    const pid = Number((await readFile(path.join(directory, 'pid'), 'utf8').catch(() => '')).trim());
    if (!pid || !processIsAlive(pid)) await rm(directory, { recursive: true, force: true });
  }
}

async function acquireLock(): Promise<void> {
  if (skipLock) return;
  await mkdir(lockRoot, { recursive: true });
  const directory = path.join(lockRoot, `dev-${slug}.lockdir`);
  try {
    await mkdir(directory);
  } catch {
    const pid = Number((await readFile(path.join(directory, 'pid'), 'utf8').catch(() => '')).trim());
    if (pid && processIsAlive(pid)) {
      throw new Error(`Já existe um dev server para este worktree (PID ${pid}). Não vou derrubar o ambiente de outro agente.`);
    }
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory);
  }
  await writeFile(path.join(directory, 'pid'), String(process.pid));
  await writeFile(path.join(directory, 'branch'), branch);
  await writeFile(path.join(directory, 'ports'), JSON.stringify(currentPorts));
  lockDir = directory;
}

async function releaseLock(): Promise<void> {
  if (!lockDir) return;
  await rm(lockDir, { recursive: true, force: true }).catch(() => {});
  lockDir = null;
}

function dockerAvailable(): boolean {
  const result = Bun.spawnSync(['docker', '--version'], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  return result.exitCode === 0;
}

function startStack(): void {
  const args = ['up', '-d'];
  if (buildImages) args.push('--build');
  args.push('--wait');
  stackStarted = true;
  const result = compose(args);
  if (result.exitCode !== 0) throw new Error('docker compose up falhou. Veja o erro acima.');
}

function stopStack(): void {
  if (!stackStarted) return;
  console.log('  ⏳ Derrubando stack Docker...');
  const args = ['down', '--remove-orphans', '--timeout', '15'];
  if (process.env.NUKE_DATA === '1') args.push('--volumes');
  const result = compose(args);
  if (result.exitCode === 0) {
    stackStarted = false;
    console.log('  ✓ Stack Docker parada');
  }
}

function cloudflared(args: string[], capture = false): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync([cloudflaredBin, ...args], {
    cwd: REPO_ROOT,
    stdout: capture ? 'pipe' : 'inherit',
    stderr: capture ? 'pipe' : 'inherit',
    timeout: 120_000,
  });
  return { exitCode: result.exitCode, stdout: text(result.stdout), stderr: text(result.stderr) };
}

type CloudflareDnsRecord = { id: string; name: string; content: string };
type CloudflareResponse<T> = { success: boolean; result: T; errors?: Array<{ message?: string }> };

async function cloudflareRequest<T>(pathName: string, init?: RequestInit): Promise<T> {
  if (!cloudflareApiToken) throw new Error('CLOUDFLARE_API_TOKEN não configurado.');
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathName}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cloudflareApiToken}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const data = await response.json() as CloudflareResponse<T>;
  if (!response.ok || !data.success) {
    const reason = data.errors?.map((error) => error.message).filter(Boolean).join('; ');
    throw new Error(`Cloudflare API ${response.status}: ${reason || 'falha desconhecida'}`);
  }
  return data.result;
}

async function ensureTunnelDns(tunnelUuid: string): Promise<void> {
  if (!cloudflareApiToken || !cloudflareZoneId) return;
  const name = encodeURIComponent(tunnelHostname);
  const existing = await cloudflareRequest<CloudflareDnsRecord[]>(
    `/zones/${cloudflareZoneId}/dns_records?type=CNAME&name=${name}`,
  );
  const payload = JSON.stringify({
    type: 'CNAME',
    name: tunnelHostname,
    content: `${tunnelUuid}.cfargotunnel.com`,
    proxied: true,
    ttl: 1,
  });
  if (existing[0]) {
    await cloudflareRequest<CloudflareDnsRecord>(
      `/zones/${cloudflareZoneId}/dns_records/${existing[0].id}`,
      { method: 'PUT', body: payload },
    );
  } else {
    await cloudflareRequest<CloudflareDnsRecord>(
      `/zones/${cloudflareZoneId}/dns_records`,
      { method: 'POST', body: payload },
    );
  }
  console.log(`  ✓ [tunnel] DNS configurado: ${tunnelHostname}`);
}

function resolveTunnelId(): string {
  const configuredId = process.env.TUNNEL_ID?.trim();
  if (configuredId) return configuredId;

  const listed = cloudflared(['tunnel', 'list', '--output', 'json'], true);
  if (listed.exitCode === 0) {
    try {
      const tunnels = JSON.parse(listed.stdout) as Array<{ id?: string; name?: string }>;
      const existing = tunnels.find((tunnel) => tunnel.name === tunnelName && tunnel.id);
      if (existing?.id) return existing.id;
    } catch {
      // cloudflared sometimes emits a warning before the JSON; the create path
      // below remains the reliable fallback.
    }
  }

  if (requestedDryRun) return '';
  console.log(`  🚇 [tunnel] Criando tunnel Cloudflare: ${tunnelName}`);
  const created = cloudflared(['tunnel', 'create', tunnelName], true);
  if (created.exitCode !== 0) {
    throw new Error(`Não foi possível criar o tunnel ${tunnelName}: ${created.stderr || created.stdout}`);
  }

  const createdId = `${created.stdout}\n${created.stderr}`.match(
    /(?:with id|id:)\s*([0-9a-f-]{36})/i,
  )?.[1];
  if (createdId) return createdId;

  const refreshed = cloudflared(['tunnel', 'list', '--output', 'json'], true);
  try {
    const tunnels = JSON.parse(refreshed.stdout) as Array<{ id?: string; name?: string }>;
    const createdTunnel = tunnels.find((tunnel) => tunnel.name === tunnelName && tunnel.id);
    if (createdTunnel?.id) return createdTunnel.id;
  } catch {
    // Fall through to the actionable error below.
  }
  throw new Error(`O tunnel ${tunnelName} foi criado, mas não consegui descobrir o UUID.`);
}

async function prepareNamedTunnel(): Promise<void> {
  const resolvedTunnelId = resolveTunnelId();
  if (requestedDryRun || !resolvedTunnelId) {
    console.log(`  ℹ [tunnel] Dry-run: criaria o tunnel ${tunnelName}`);
    return;
  }

  const credentialsFile = process.env.TUNNEL_CREDENTIALS_FILE
    ?? path.join(HOME, '.cloudflared', `${resolvedTunnelId}.json`);
  if (!existsSync(credentialsFile)) {
    throw new Error(`Credencial do tunnel não encontrada: ${credentialsFile}`);
  }

  const generatedConfig = path.join(lockRoot, 'cloudflared', `${slug}.yml`);
  const generated = [
    `tunnel: ${resolvedTunnelId}`,
    `credentials-file: /etc/cloudflared/${resolvedTunnelId}.json`,
    '',
    'ingress:',
    `  - hostname: ${tunnelHostname}`,
    '    service: http://web:5441',
    '    originRequest:',
    '      noTLSVerify: false',
    '      connectTimeout: 30s',
    '      noHappyEyeballs: false',
    '  - service: http_status:404',
    '',
  ].join('\n');
  mkdirSync(path.dirname(generatedConfig), { recursive: true });
  writeFileSync(generatedConfig, generated);
  tunnelConfigPath = generatedConfig;

  process.env.DEV_TUNNEL_CONFIG_HOST_PATH = generatedConfig.replaceAll('\\', '/');
  process.env.DEV_TUNNEL_CREDENTIALS_HOST_PATH = credentialsFile.replaceAll('\\', '/');
  process.env.DEV_TUNNEL_ID = resolvedTunnelId;
  tunnelProfileEnabled = true;

  if (cloudflareApiToken && cloudflareZoneId) {
    console.log(`  ℹ [tunnel] DNS via API habilitado para ${tunnelHostname}`);
  } else {
    console.log(`  ℹ [tunnel] DNS automático desativado para ${tunnelHostname}.`);
    console.log('    Configure o CNAME no dashboard Cloudflare ou informe CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID da zona correta.');
  }

  await ensureTunnelDns(resolvedTunnelId);
  console.log(`  ✓ [tunnel] ${tunnelName} preparado; config: ${generatedConfig}`);
}

async function prepareQuickTunnel(): Promise<void> {
  if (requestedDryRun) {
    console.log(`  ℹ [tunnel] Dry-run: subiria um quick tunnel ${tunnelMode === 'quick' ? 'forçado' : 'automático'}`);
    return;
  }
  const url = currentPorts ? `http://127.0.0.1:${currentPorts.web}` : 'http://127.0.0.1:5441';
  console.log(`  🚇 [tunnel] Subindo quick tunnel (trycloudflare) → ${url}`);

  const proc = Bun.spawn([cloudflaredBin, 'tunnel', '--url', url, '--no-autoupdate'], {
    cwd: REPO_ROOT,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const decoder = new TextDecoder();
  let buffer = '';
  let resolved = false;
  const reader = (async () => {
    const r = proc.stderr.getReader();
    try {
      while (true) {
        const { value, done } = await r.read();
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          process.stderr.write(`  \x1b[35m[tunnel]\x1b[0m ${chunk}`);
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';
          for (const line of lines) {
            const match = line.match(/https:\/\/\S+\.trycloudflare\.com/);
            if (match && !resolved) {
              resolved = true;
              quickTunnelUrl = match[0];
              console.log('');
              console.log('  ┌──────────────────────────────────────────────────────────────');
              console.log(`  │  URL pública (quick tunnel): ${quickTunnelUrl}`);
              console.log(`  │  URL local:                 http://localhost:${currentPorts?.web ?? 5441}`);
              console.log('  └──────────────────────────────────────────────────────────────');
              console.log('');
              composeEnvironment(currentPorts!);
            }
          }
        }
        if (done) break;
      }
    } finally {
      r.releaseLock();
    }
  })();

  proc.exited.then(() => {
    if (!quickTunnelUrl && !resolved) {
      console.error('  ⚠ [tunnel] cloudflared encerrou antes de publicar a URL do quick tunnel.');
    }
  });

  // Don't await reader; quick tunnel runs for the lifetime of the process.
  void reader;
}

function terminateQuickTunnel(): void {
  if (!quickTunnelUrl) return;
  // cloudflared will be killed by Ctrl+C in the parent shell; nothing to do here
  // because the process is tracked by the OS once detached.
}

async function prepareTunnel(): Promise<void> {
  if (skipTunnel) return;
  if (tunnelMode === 'quick') return prepareQuickTunnel();
  if (tunnelMode === 'named') return prepareNamedTunnel();
  console.log(`  ⚠ [tunnel] Modo desconhecido (${tunnelMode}), seguindo sem tunnel.`);
}

async function cleanup(exitCode: number): Promise<void> {
  if (cleanExit) return;
  cleanExit = true;
  if (!keepStack) stopStack();
  else console.log('  ℹ KEEP_INFRA=1: containers mantidos rodando');

  await releaseLock();
  if (!keepStack && stateFile) await rm(stateFile, { force: true }).catch(() => {});
  if (tunnelConfigPath && !keepStack) await rm(tunnelConfigPath, { force: true }).catch(() => {});
  terminateQuickTunnel();
  console.log('✓ Ambiente dev finalizado.');
  process.exit(exitCode);
}

function printConfiguration(ports: PortMap): void {
  console.log('');
  console.log('O Mestre Afiliado — Dev por worktree');
  console.log(`  Branch:    ${branch}`);
  console.log(`  Worktree:  ${worktreeName}`);
  console.log(`  Slug:      ${slug}`);
  console.log(`  Compose:   ${composeProject}`);
  console.log(`  Modo:      ${tunnelMode === 'quick' ? 'quick tunnel (trycloudflare)' : 'tunnel nomeado'}`);
  console.log(`  Tunnel:    ${skipTunnel ? 'SKIP' : tunnelPublicUrl()}`);
  if (!skipTunnel && tunnelMode === 'named' && (!cloudflareApiToken || !cloudflareZoneId)) {
    console.log('              DNS automático desativado (configure CLOUDFLARE_API_TOKEN + CLOUDFLARE_ZONE_ID)');
  }
  console.log(`  Web:       http://localhost:${ports.web}`);
  console.log(`  API:       http://localhost:${ports.api}`);
  console.log(`  Postgres:  localhost:${ports.postgres}`);
  console.log(`  Evolution: localhost:${ports.evolution}`);
  console.log(`  Redis:     localhost:${ports.redis}`);
  console.log(`  Ingestor:  localhost:${ports.ingestor}`);
  console.log(`  Dispatcher: localhost:${ports.dispatcher}`);
  console.log(`  Env:       ${appEnvFile}`);
  console.log('');
  if (!skipTunnel && tunnelMode === 'quick') {
    console.log('  ℹ A URL pública do quick tunnel aparece logo abaixo assim que o cloudflared conectar.');
    console.log('');
  }
}

async function waitForever(): Promise<void> {
  await new Promise<void>(() => {
    setInterval(() => {}, 60_000);
  });
}

async function main(): Promise<void> {
  process.on('SIGINT', () => { void cleanup(130); });
  process.on('SIGTERM', () => { void cleanup(143); });
  process.on('uncaughtException', (error) => {
    console.error('\nErro não capturado:', error);
    void cleanup(1);
  });

  await cleanStaleLocks();
  const ports = await choosePorts();
  composeEnvironment(ports);
  printConfiguration(ports);

  if (requestedDryRun) {
    return;
  }
  if (!existsSync(appEnvFile)) {
    throw new Error(`Arquivo de ambiente não encontrado: ${appEnvFile}. Crie .env no worktree ou defina DEV_APP_ENV_FILE.`);
  }
  if (!existsSync(composeFile)) throw new Error(`Compose não encontrado: ${composeFile}`);
  if (!dockerAvailable()) throw new Error('Docker Desktop não está disponível.');

  await acquireLock();
  try {
    await prepareTunnel();
    await persistState(ports);
    startStack();
  } catch (error) {
    if (stackStarted) stopStack();
    throw error;
  }

  console.log('');
  console.log('  Ctrl-C para parar a stack e liberar as portas.');
  if (keepStack) console.log('  KEEP_INFRA=1 mantém os containers após Ctrl-C.');
  console.log('');

  await waitForever();
}

main().catch(async (error) => {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  await releaseLock();
  if (stateFile && !keepStack) await rm(stateFile, { force: true }).catch(() => {});
  if (tunnelConfigPath && !keepStack) await rm(tunnelConfigPath, { force: true }).catch(() => {});
  process.exit(1);
});
