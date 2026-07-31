import { describe, expect, test } from 'bun:test';
import { validateMagaluStoreSlug } from './magalu-config-pure.ts';

describe('validateMagaluStoreSlug', () => {
  test('aceita slug com letras minúsculas, números e hífen', () => {
    expect(validateMagaluStoreSlug('magazinevoce-123')).toEqual({ valid: true });
  });

  test('rejeita slug vazio ou curto demais', () => {
    expect(validateMagaluStoreSlug('')).toEqual({
      valid: false,
      reason: 'O slug deve ter entre 3 e 40 caracteres.',
    });
    expect(validateMagaluStoreSlug('ab').valid).toBe(false);
  });

  test('rejeita caracteres que não fazem parte do formato da loja', () => {
    expect(validateMagaluStoreSlug('MinhaLoja')).toEqual({
      valid: false,
      reason: 'Use apenas letras minúsculas, números e hífen.',
    });
    expect(validateMagaluStoreSlug('minha loja').valid).toBe(false);
  });

  test('rejeita slug acima do limite', () => {
    expect(validateMagaluStoreSlug('a'.repeat(41))).toEqual({
      valid: false,
      reason: 'O slug deve ter entre 3 e 40 caracteres.',
    });
  });
});
