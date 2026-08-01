/**
 * Validação pura do formulário de espelhamento (MirrorFormPage).
 *
 * Lógica de validação isolada em função pura (sem React/DOM) para
 * reuso no submit e no blur de cada campo, e para cobertura unitária.
 */
export interface MirrorFormGroup {
  jid: string;
  name: string;
}

export interface MirrorFormValues {
  name: string;
  sourceGroups: readonly MirrorFormGroup[];
  targetGroups: readonly MirrorFormGroup[];
}

export interface MirrorFormErrors {
  name?: string;
  sourceGroups?: string;
  targetGroups?: string;
}

/** Tamanho máximo do nome do espelhamento (alinhado ao maxLength do input). */
export const MIRROR_NAME_MAX_LENGTH = 255;

/**
 * Valida os campos obrigatórios do formulário de espelhamento.
 * Retorna um objeto com erro por campo — campos válidos ficam sem chave.
 */
export function validateMirrorForm({
  name,
  sourceGroups,
  targetGroups,
}: MirrorFormValues): MirrorFormErrors {
  const errors: MirrorFormErrors = {};

  const trimmedName = name.trim();
  if (!trimmedName) {
    errors.name = 'O nome é obrigatório';
  } else if (trimmedName.length > MIRROR_NAME_MAX_LENGTH) {
    errors.name = `O nome deve ter no máximo ${MIRROR_NAME_MAX_LENGTH} caracteres`;
  }

  if (sourceGroups.length === 0) {
    errors.sourceGroups = 'Selecione pelo menos 1 grupo de origem';
  }

  if (targetGroups.length === 0) {
    errors.targetGroups = 'Selecione pelo menos 1 grupo de destino';
  }

  return errors;
}
