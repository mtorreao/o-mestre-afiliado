/**
 * GroupOfferAutocomplete-pure.ts — Lógica pura (sem React/DOM) do
 * GroupOfferAutocomplete. Extraída para cobertura 100% sem precisar
 * montar DOM.
 *
 * - `filterGroups` aplica a busca + exclui já selecionados
 * - `isMaxed` sinaliza quando o limite foi atingido
 * - `nextHighlightIndex` aplica o cursor de navegação por teclado
 * - `composeKeyDownAction` decide o que cada tecla faz no estado atual
 *   (retorna a ação, não muta state)
 */

export interface GroupItem {
  jid: string;
  name: string;
}

export const MAX_SELECTION = 3;

/** Aplica filtro textual e remove grupos já selecionados. */
export function filterGroups(
  groups: readonly GroupItem[],
  selected: readonly GroupItem[],
  query: string,
): GroupItem[] {
  const selectedJids = new Set(selected.map((g) => g.jid));
  const q = query.trim().toLowerCase();
  return groups.filter((g) => {
    if (selectedJids.has(g.jid)) return false;
    if (!q) return true;
    return g.name.toLowerCase().includes(q);
  });
}

/** true quando o número de selecionados atingiu MAX_SELECTION. */
export function isMaxed(selected: readonly GroupItem[]): boolean {
  return selected.length >= MAX_SELECTION;
}

/** Move o cursor com ArrowDown/ArrowUp respeitando os limites [0, length-1]. */
export function nextHighlightIndex(current: number, delta: 1 | -1, length: number): number {
  if (length <= 0) return -1;
  const next = current + delta;
  if (next < 0) return 0;
  if (next >= length) return length - 1;
  return next;
}

/** Ações decididas pelo handler de teclado (sem side-effects). */
export type KeyAction =
  | { type: 'open'; highlightIndex: number }
  | { type: 'highlight'; index: number; preventDefault: boolean }
  | { type: 'select'; index: number; preventDefault: boolean }
  | { type: 'close' }
  | { type: 'removeLast'; preventDefault: boolean }
  | { type: 'noop' };

export interface KeyDownContext {
  isOpen: boolean;
  filteredLength: number;
  highlightIndex: number;
  query: string;
  selectedLength: number;
}

/** Decide a ação para uma tecla específica no contexto do combobox. */
export function composeKeyDownAction(key: string, ctx: KeyDownContext): KeyAction {
  if (!ctx.isOpen) {
    if (key === 'ArrowDown' || key === 'Enter') {
      return { type: 'open', highlightIndex: 0 };
    }
    return { type: 'noop' };
  }

  switch (key) {
    case 'ArrowDown':
      return {
        type: 'highlight',
        index: nextHighlightIndex(ctx.highlightIndex, 1, ctx.filteredLength),
        preventDefault: true,
      };
    case 'ArrowUp':
      return {
        type: 'highlight',
        index: nextHighlightIndex(ctx.highlightIndex, -1, ctx.filteredLength),
        preventDefault: true,
      };
    case 'Enter':
      return {
        type: 'select',
        index: ctx.highlightIndex,
        preventDefault: true,
      };
    case 'Escape':
      return { type: 'close' };
    case 'Backspace':
      if (!ctx.query && ctx.selectedLength > 0) {
        return { type: 'removeLast', preventDefault: false };
      }
      return { type: 'noop' };
    case 'Tab':
      return { type: 'close' };
    default:
      return { type: 'noop' };
  }
}
