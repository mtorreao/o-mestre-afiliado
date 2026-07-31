/**
 * Testes da validação pura do formulário de espelhamento (MirrorFormPage).
 *
 * Cobre: nome vazio, nome > 255, sem origem, sem destino e form válido —
 * sem React, sem DOM, só lógica pura.
 */
import { describe, expect, it } from 'bun:test';
import { MIRROR_NAME_MAX_LENGTH, validateMirrorForm } from './mirror-form-pure.ts';

const group = (jid: string, name: string) => ({ jid, name });

describe('validateMirrorForm', () => {
  it('retorna erro em nome, origem e destino quando o form está vazio', () => {
    const errors = validateMirrorForm({ name: '', sourceGroups: [], targetGroups: [] });

    expect(errors.name).toBe('O nome é obrigatório');
    expect(errors.sourceGroups).toBe('Selecione pelo menos 1 grupo de origem');
    expect(errors.targetGroups).toBe('Selecione pelo menos 1 grupo de destino');
  });

  it('trata nome com apenas espaços como vazio', () => {
    const errors = validateMirrorForm({
      name: '   ',
      sourceGroups: [group('1', 'Origem')],
      targetGroups: [group('2', 'Destino')],
    });

    expect(errors.name).toBe('O nome é obrigatório');
  });

  it('rejeita nome com mais de 255 caracteres', () => {
    const errors = validateMirrorForm({
      name: 'x'.repeat(MIRROR_NAME_MAX_LENGTH + 1),
      sourceGroups: [group('1', 'Origem')],
      targetGroups: [group('2', 'Destino')],
    });

    expect(errors.name).toBe(`O nome deve ter no máximo ${MIRROR_NAME_MAX_LENGTH} caracteres`);
  });

  it('aceita nome com exatamente 255 caracteres (limite inclusivo)', () => {
    const errors = validateMirrorForm({
      name: 'x'.repeat(MIRROR_NAME_MAX_LENGTH),
      sourceGroups: [group('1', 'Origem')],
      targetGroups: [group('2', 'Destino')],
    });

    expect(errors.name).toBeUndefined();
  });

  it('retorna erro apenas de origem quando só falta origem', () => {
    const errors = validateMirrorForm({
      name: 'Ofertas Diárias',
      sourceGroups: [],
      targetGroups: [group('2', 'Destino')],
    });

    expect(errors.name).toBeUndefined();
    expect(errors.sourceGroups).toBe('Selecione pelo menos 1 grupo de origem');
    expect(errors.targetGroups).toBeUndefined();
  });

  it('retorna erro apenas de destino quando só falta destino', () => {
    const errors = validateMirrorForm({
      name: 'Ofertas Diárias',
      sourceGroups: [group('1', 'Origem')],
      targetGroups: [],
    });

    expect(errors.name).toBeUndefined();
    expect(errors.sourceGroups).toBeUndefined();
    expect(errors.targetGroups).toBe('Selecione pelo menos 1 grupo de destino');
  });

  it('não retorna erro algum para form válido', () => {
    const errors = validateMirrorForm({
      name: 'Ofertas Diárias',
      sourceGroups: [group('1', 'Origem')],
      targetGroups: [group('2', 'Destino')],
    });

    expect(errors).toEqual({});
  });

  it('valida o nome após trim (espaços ao redor não contam)', () => {
    const errors = validateMirrorForm({
      name: '  Ofertas Diárias  ',
      sourceGroups: [group('1', 'Origem')],
      targetGroups: [group('2', 'Destino')],
    });

    expect(errors).toEqual({});
  });
});
