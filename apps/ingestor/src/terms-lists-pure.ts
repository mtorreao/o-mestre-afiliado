/**
 * Lógica PURA de parse/matching de listas de termos (blacklist/whitelist).
 *
 * Separa o parse de JSON, a normalização de termos e o matching (case-
 * insensitive) da camada de I/O (leitura de disco + cache em globalThis,
 * que vive em `terms-lists.ts`). Todas as funções aqui são síncronas,
 * sem dependência de rede/DB/fs e 100% testáveis.
 */

export interface TermsFileParseResult {
  /** Termos normalizados (trim, não-vazios, duplicados removidos). */
  terms: string[];
  /** true se o JSON foi parseado com sucesso. */
  ok: boolean;
  /** Mensagem de erro se ok === false (JSON inválido / formato errado). */
  error?: string;
}

export interface TermMatch {
  /** true se algum termo casou (case-insensitive substring). */
  matched: boolean;
  /** Termo que casou primeiro (lowercase), ou null se nenhum. */
  term?: string;
}

/**
 * Faz o parse de um arquivo JSON de termos no formato { terms: [...] }.
 *
 * Regras de normalização:
 *  - JSON inválido → { terms: [], ok: false, error } (NÃO lança).
 *  - `terms` ausente / não-array → { terms: [], ok: false, error }.
 *  - Cada entrada é convertida para string, feita trim e descartada se
 *    vazia. Duplicatas (após trim) são removidas, preservando a ordem.
 *  - Entradas não-string (números, etc.) são coeridas via String().
 */
export function parseTermsFile(raw: string): TermsFileParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      terms: [],
      ok: false,
      error: `JSON inválido: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { terms: [], ok: false, error: 'Formato esperado: objeto com chave "terms"' };
  }

  const rawTerms = (parsed as { terms?: unknown }).terms;
  if (!Array.isArray(rawTerms)) {
    return { terms: [], ok: false, error: 'Chave "terms" ausente ou não é array' };
  }

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const item of rawTerms) {
    const normalized = String(item).trim();
    if (normalized.length === 0) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    terms.push(normalized);
  }

  return { terms, ok: true };
}

/**
 * Verifica se algum dos `terms` aparece como substring (case-insensitive)
 * no `text` fornecido.
 *
 * Casos de borda:
 *  - terms vazio → matched: false (nada a bloquear/aprovar).
 *  - text vazio → matched: false (não há onde casar).
 *  - Retorna o primeiro termo que casou (lowercase) para log/debug.
 */
export function matchAnyTerm(text: string, terms: string[]): TermMatch {
  if (terms.length === 0 || text.length === 0) {
    return { matched: false };
  }
  const textLower = text.toLowerCase();
  for (const term of terms) {
    const termLower = term.toLowerCase();
    if (termLower.length === 0) continue;
    if (textLower.includes(termLower)) {
      return { matched: true, term: termLower };
    }
  }
  return { matched: false };
}
