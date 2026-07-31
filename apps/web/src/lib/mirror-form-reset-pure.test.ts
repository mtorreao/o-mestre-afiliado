import { describe, expect, it } from 'bun:test';
import { createEmptyMirrorFormState } from './mirror-form-reset-pure.ts';

describe('createEmptyMirrorFormState', () => {
  it('retorna todos os campos do form vazios', () => {
    const state = createEmptyMirrorFormState();
    expect(state.name).toBe('');
    expect(state.sourceGroups).toEqual([]);
    expect(state.targetGroups).toEqual([]);
    expect(state.messageTemplate).toBe('');
  });

  it('limpa todos os erros de validação e submit', () => {
    const state = createEmptyMirrorFormState();
    expect(state.nameError).toBeNull();
    expect(state.sourceError).toBeNull();
    expect(state.targetError).toBeNull();
    expect(state.submitError).toBeNull();
  });

  it('sai do estado de sucesso', () => {
    expect(createEmptyMirrorFormState().success).toBe(false);
  });

  it('retorna objeto e arrays novos a cada chamada (sem referência compartilhada)', () => {
    const a = createEmptyMirrorFormState();
    const b = createEmptyMirrorFormState();
    expect(a).not.toBe(b);
    expect(a.sourceGroups).not.toBe(b.sourceGroups);
    expect(a.targetGroups).not.toBe(b.targetGroups);
  });
});
