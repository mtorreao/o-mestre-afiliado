/**
 * useTheme-pure.ts — Lógica pura (sem DOM) do hook useTheme.
 *
 * Extraída do useTheme.tsx para cobertura 100% sem precisar mockar
 * `document.documentElement` ou `localStorage` em todo lugar.
 *
 * - `resolveInitialTheme(stored)` decide qual tema aplicar a partir
 *   do que está persistido (ou undefined para primeira visita).
 * - `resolveNextTheme(current)` é a regra do toggle: alterna entre
 *   'light' e 'dark'.
 * - `THEME_STORAGE_KEY` é a constante exportada para que o hook e os
 *   testes compartilhem a mesma chave (evita drift).
 */
export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';

export const DEFAULT_THEME: Theme = 'light';

/** Lê o tema inicial a partir do que está persistido. Aceita qualquer
 *  valor (incluindo null/undefined/strings arbitrarias) e cai no default
 *  quando o valor persistido nao e um Theme valido. */
export function resolveInitialTheme(stored: string | null | undefined): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return DEFAULT_THEME;
}

/** Proximo tema apos toggle: alterna estritamente entre light e dark. */
export function resolveNextTheme(current: Theme): Theme {
  return current === 'light' ? 'dark' : 'light';
}

/** Coercao segura: aceita qualquer entrada e devolve um Theme valido. */
export function coerceTheme(value: unknown): Theme {
  return value === 'dark' ? 'dark' : 'light';
}
