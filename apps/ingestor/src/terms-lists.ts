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
 *
 * A lógica de PARSE/normalização/matching é 100% PURA (sem I/O) e vive em
 * `terms-lists-pure.ts`, permitindo cobertura total via teste unitário.
 * Este módulo orquestra apenas o cache em globalThis + leitura de disco.
 */
import { existsSync, readFileSync } from 'fs';
import { makeLogger } from '@omestre/shared';
import { config } from './config.ts';
import {
  parseTermsFile,
  type TermsFileParseResult,
  matchAnyTerm,
  type TermMatch,
} from './terms-lists-pure.ts';

const log = makeLogger('ingestor');

function loadTermsList(envPath: string, defaultPath: string, label: string): string[] {
  const cacheKey = `_cache_${label}` as keyof typeof globalThis;
  if ((globalThis as Record<string, unknown>)[cacheKey] !== undefined) {
    return (globalThis as Record<string, unknown>)[cacheKey] as string[];
  }

  const filePath = process.env[envPath] || defaultPath;
  let parsed: TermsFileParseResult | null = null;
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      parsed = parseTermsFile(raw);
      const terms = parsed.terms;
      (globalThis as Record<string, unknown>)[cacheKey] = terms;
      log('info', `${label} carregada: ${terms.length} termo(s) de ${filePath}`);
      return terms;
    }
    log('info', `Arquivo ${filePath} não encontrado, ${label.toLowerCase()} vazia`);
  } catch (err) {
    log('warn', `Erro ao carregar ${label.toLowerCase()}`, {
      path: filePath,
      error: String(err),
    });
  }

  // Fallback: lista vazia (parse falhou ou arquivo ausente).
  if (parsed === null) {
    (globalThis as Record<string, unknown>)[cacheKey] = [];
    return [];
  }

  // parseTermsFile nunca retorna null em caso de JSON inválido — retorna
  // { terms: [] } com erro registrado. Chegamos aqui se o arquivo não existe.
  (globalThis as Record<string, unknown>)[cacheKey] = parsed.terms;
  return parsed.terms;
}

export function loadBlacklist(): string[] {
  return loadTermsList('BLACKLIST_PATH', config.BLACKLIST_PATH, 'Blacklist');
}

export function loadWhitelist(): string[] {
  return loadTermsList('WHITELIST_PATH', config.WHITELIST_PATH, 'Whitelist');
}

// ─── Re-exporta as puras para reunir tudo de terms-lists em um só módulo ─
export { parseTermsFile, matchAnyTerm };
export type { TermsFileParseResult, TermMatch };
