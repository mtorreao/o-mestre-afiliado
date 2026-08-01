/**
 * mirror-form-reset-pure.ts — Estado vazio do MirrorFormPage (lógica pura).
 *
 * Extraída para permitir cobertura unitária da ação "Criar outro espelhamento":
 * o reset do form (campos + erros + flag de sucesso) é um snapshot determinístico,
 * sem dependência de DOM, fetch ou estado do React.
 */

export interface MirrorFormResetState {
  name: string;
  sourceGroups: { jid: string; name: string }[];
  targetGroups: { jid: string; name: string }[];
  messageTemplate: string;
  nameError: string | null;
  sourceError: string | null;
  targetError: string | null;
  submitError: string | null;
  success: boolean;
}

/**
 * Retorna o estado inicial do formulário de espelhamento (modo "novo").
 * Cada chamada devolve um objeto novo — arrays não são compartilhados
 * entre chamadas, então mutações no componente não vazam.
 */
export function createEmptyMirrorFormState(): MirrorFormResetState {
  return {
    name: '',
    sourceGroups: [],
    targetGroups: [],
    messageTemplate: '',
    nameError: null,
    sourceError: null,
    targetError: null,
    submitError: null,
    success: false,
  };
}
