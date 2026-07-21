/**
 * Global Teardown para testes E2E.
 *
 * Derruba o stack Docker Compose após os testes.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const COMPOSE_FILE = resolve(process.cwd(), 'e2e/docker-compose.e2e.yml');

async function main() {
  if (!existsSync(COMPOSE_FILE)) {
    console.warn(`⚠️  Arquivo não encontrado: ${COMPOSE_FILE} — pulando teardown`);
    return;
  }

  console.log('🔄 Derrubando stack E2E...');

  try {
    await run('docker', [
      'compose',
      '-f', COMPOSE_FILE,
      'down', '-v', '--remove-orphans', '--timeout', '30',
    ]);
    console.log('✅ Stack E2E removida');
  } catch (err) {
    // Teardown não deve falhar o test run
    console.warn('⚠️  Erro ao derrubar stack:', err instanceof Error ? err.message : String(err));
  }
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
