/**
 * Gera lib/log-sink.config.js com a API key embutida para a extensão Chrome.
 *
 * O service worker importa esse arquivo ANTES de lib/log-sink.js via
 * importScripts. A key vem do .env (EXTENSION_LOGS_API_KEY). Se não estiver
 * configurada, gera string vazia (sink fica inerte — fail-safe).
 *
 * O arquivo gerado é IGNORADO pelo git (contém secret).
 *
 * Uso:
 *   bun run scripts/build-extension-config.ts
 */
import { writeFileSync } from 'fs';
import { resolve } from 'path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'extensions/chrome-cookie-importer/lib/log-sink.config.js');

// Tenta ler do .env na raiz (sem dependência externa).
function readEnvApiKey(): string {
  try {
    const envFile = Bun.file(resolve(REPO_ROOT, '.env'));
    const content = envFile.text();
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*EXTENSION_LOGS_API_KEY\s*=\s*(.+?)\s*$/);
      if (m) return m[1]!.replace(/^['"]|['"]$/g, '');
    }
  } catch {
    /* sem .env */
  }
  // Fallback: process.env (caso rode com EXTENSION_LOGS_API_KEY=xxx bun run ...)
  return process.env.EXTENSION_LOGS_API_KEY || '';
}

const apiKey = readEnvApiKey();

const content = `// ⚠️  ARQUIVO GERADO AUTOMATICAMENTE — NÃO EDITAR MANUALMENTE
// Gerado por scripts/build-extension-config.ts a partir de .env
// NÃO commitar este arquivo (já está no .gitignore).

(function () {
  globalThis.__EXT_LOGS_API_KEY__ = ${JSON.stringify(apiKey)};
})();
`;

writeFileSync(CONFIG_PATH, content);

if (apiKey) {
  console.log(`✅ log-sink.config.js gerado com API key (${apiKey.length} chars)`);
} else {
  console.log(
    '⚠️  log-sink.config.js gerado SEM API key (EXTENSION_LOGS_API_KEY vazia). Sink fica inerte.',
  );
}
