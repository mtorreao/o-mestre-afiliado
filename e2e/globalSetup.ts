/**
 * Global Setup para testes E2E.
 *
 * Sobe o stack Docker Compose antes dos testes.
 *
 * Uso:
 *   docker compose -f e2e/docker-compose.e2e.yml up -d --wait
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const COMPOSE_FILE = resolve(process.cwd(), 'e2e/docker-compose.e2e.yml');

async function main() {
  if (!existsSync(COMPOSE_FILE)) {
    console.error(`Arquivo não encontrado: ${COMPOSE_FILE}`);
    process.exit(1);
  }

  console.log('🔄 Subindo stack E2E...');
  console.log(`   docker compose -f ${COMPOSE_FILE} up -d --wait`);

  await run('docker', [
    'compose',
    '-f', COMPOSE_FILE,
    'up', '-d', '--wait',
    '--remove-orphans',
  ]);

  console.log('✅ Stack E2E pronta!');

  // Aguarda um momento extra para garantir que a API esteja respondendo
  await sleep(2000);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    proc.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`"${cmd} ${args.join(' ')}" falhou com código ${code}`));
    });
    proc.on('error', reject);
  });
}

export default main;
