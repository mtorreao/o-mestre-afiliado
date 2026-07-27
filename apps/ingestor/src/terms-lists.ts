/**
 * Carregamento de blacklist e whitelist de termos.
 *
 * Lê JSON files do disco (paths via env ou defaults) e cacheia em
 * `globalThis` para evitar I/O repetido no pipeline.
 *
 * Blacklist: termos que BLOQUEIAM uma oferta (ex.: "vagas", "emprego").
 * Whitelist: termos que APROVAM mesmo com match na blacklist.
 *
 * Formato JSON esperado:
 *   { "terms": ["termo1", "termo2", ...] }
 */
import { existsSync, readFileSync } from 'fs';

interface TermsFile {
  terms?: string[];
}

function log(level: 'info' | 'warn', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'ingestor',
    message,
    ...(data && typeof data === 'object' ? data : {}),
  };
  if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

function loadTermsList(envPath: string, defaultPath: string, label: string): string[] {
  const cacheKey = `_cache_${label}` as keyof typeof globalThis;
  if ((globalThis as Record<string, unknown>)[cacheKey] !== undefined) {
    return (globalThis as Record<string, unknown>)[cacheKey] as string[];
  }

  const filePath = process.env[envPath] || defaultPath;
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(raw) as TermsFile;
      const terms = config.terms ?? [];
      (globalThis as Record<string, unknown>)[cacheKey] = terms;
      log('info', `${label} carregada: ${terms.length} termo(s) de ${filePath}`);
      return terms;
    }
    log('info', `Arquivo ${filePath} não encontrado, ${label.toLowerCase()} vazia`);
  } catch (err) {
    log('warn', `Erro ao carregar ${label.toLowerCase()}`, { path: filePath, error: String(err) });
  }

  (globalThis as Record<string, unknown>)[cacheKey] = [];
  return [];
}

export function loadBlacklist(): string[] {
  return loadTermsList('BLACKLIST_PATH', '../../blacklist.json', 'Blacklist');
}

export function loadWhitelist(): string[] {
  return loadTermsList('WHITELIST_PATH', '../../whitelist.json', 'Whitelist');
}
