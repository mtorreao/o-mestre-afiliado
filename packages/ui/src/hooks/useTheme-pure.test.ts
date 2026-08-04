import { describe, it, expect } from 'bun:test';
import {
  resolveInitialTheme,
  resolveNextTheme,
  coerceTheme,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  type Theme,
} from './useTheme-pure.ts';

describe('useTheme-pure (lógica sem DOM)', () => {
  it('DEFAULT_THEME é light', () => {
    expect(DEFAULT_THEME).toBe('light');
  });

  it('THEME_STORAGE_KEY é "theme" (chave de persistência)', () => {
    expect(THEME_STORAGE_KEY).toBe('theme');
  });

  describe('resolveInitialTheme', () => {
    it('devolve "light" quando stored=null', () => {
      expect(resolveInitialTheme(null)).toBe('light');
    });

    it('devolve "light" quando stored=undefined', () => {
      expect(resolveInitialTheme(undefined)).toBe('light');
    });

    it('devolve "light" quando stored é string vazia', () => {
      expect(resolveInitialTheme('')).toBe('light');
    });

    it('devolve "light" quando stored é string inválida', () => {
      expect(resolveInitialTheme('pink')).toBe('light');
      expect(resolveInitialTheme('DARK')).toBe('light'); // case-sensitive
      expect(resolveInitialTheme('light ')).toBe('light'); // trailing space invalida
    });

    it('preserva "light" quando stored="light"', () => {
      expect(resolveInitialTheme('light')).toBe('light');
    });

    it('preserva "dark" quando stored="dark"', () => {
      expect(resolveInitialTheme('dark')).toBe('dark');
    });
  });

  describe('resolveNextTheme (toggle)', () => {
    it('light -> dark', () => {
      expect(resolveNextTheme('light')).toBe('dark');
    });

    it('dark -> light', () => {
      expect(resolveNextTheme('dark')).toBe('light');
    });

    it('toggle duplo retorna ao estado original', () => {
      const start: Theme = 'dark';
      const once = resolveNextTheme(start);
      const twice = resolveNextTheme(once);
      expect(twice).toBe(start);
    });
  });

  describe('coerceTheme (entrada externa desconhecida)', () => {
    it('"dark" é mantido', () => {
      expect(coerceTheme('dark')).toBe('dark');
    });

    it('qualquer outra coisa cai para "light"', () => {
      expect(coerceTheme('light')).toBe('light');
      expect(coerceTheme('blue')).toBe('light');
      expect(coerceTheme(null)).toBe('light');
      expect(coerceTheme(undefined)).toBe('light');
      expect(coerceTheme(42)).toBe('light');
      expect(coerceTheme({})).toBe('light');
      expect(coerceTheme(true)).toBe('light');
    });
  });
});
