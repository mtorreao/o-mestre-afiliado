/**
 * dirty-guard-pure.ts — Lógica PURA (sem I/O, sem DOM) do dirty guard
 * do formulário de espelhamento (MirrorFormPage).
 *
 * Separa a DECISÃO (o que conta como "mudança não salva") da camada de
 * UI (window.confirm, beforeunload, estado React). As funções aqui são
 * síncronas e 100% testáveis sem navegador; o componente importa e delega.
 */

// ─── Tipos ─────────────────────────────────────────────────────────────

export interface GroupItem {
  jid: string;
  name: string;
}

export interface FormSnapshot {
  name: string;
  sourceGroups: GroupItem[];
  targetGroups: GroupItem[];
  messageTemplate: string;
}

// ─── Snapshot ──────────────────────────────────────────────────────────

/**
 * Serializa o estado do form num snapshot comparável (string JSON estável).
 * `JSON.stringify` preserva a ordem dos arrays — se o usuário reordenar
 * grupos, o snapshot difere e o form é tratado como sujo (comportamento
 * intencional: a ordem faz parte do estado editável).
 */
export function serializeFormSnapshot(values: FormSnapshot): string {
  return JSON.stringify(values);
}

/**
 * Diz se o estado atual do form difere do snapshot inicial.
 *
 * - `snapshot === null` → ainda não há snapshot (modo edição aguardando
 *   fetch, ou estado pós-save): trata como LIMPO, nunca bloqueia saída.
 * - Comparação por string serializada: qualquer diferença de valor ou
 *   ordem em name/sourceGroups/targetGroups/messageTemplate conta como dirty.
 */
export function isFormDirty(current: FormSnapshot, snapshot: string | null): boolean {
  if (snapshot === null) return false;
  return serializeFormSnapshot(current) !== snapshot;
}

// ─── Snapshot vazio (modo criação) ─────────────────────────────────────

export const EMPTY_SNAPSHOT: FormSnapshot = {
  name: '',
  sourceGroups: [],
  targetGroups: [],
  messageTemplate: '',
};
