/**
 * Testes do config-service (loadConfig + builders + validação).
 *
 * Cobre:
 *  - Builders str/num/bool/enumVar
 *  - Defaults aplicados quando env var ausente
 *  - required falha rápido se ausente
 *  - number valida que é número finito
 *  - boolean aceita "true"/"1" como true, resto como false
 *  - enum valida que valor está na lista
 *  - Singleton cache: segunda chamada retorna mesmo valor
 *  - resetConfigForTest reseta o cache
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { loadConfig, resetConfigForTest, str, num, bool, enumVar } from './config-service.ts';

describe('config-service', () => {
  beforeEach(() => {
    // Limpa env vars que os testes mexem
    delete process.env.TEST_STR;
    delete process.env.TEST_NUM;
    delete process.env.TEST_BOOL;
    delete process.env.TEST_ENUM;
    delete process.env.TEST_REQUIRED;
    resetConfigForTest();
  });

  afterEach(() => {
    resetConfigForTest();
  });

  describe('builders', () => {
    it('str retorna descritor com kind string e envName', () => {
      const d = str('FOO');
      expect(d.kind).toBe('string');
      expect((d as { envName: string }).envName).toBe('FOO');
    });

    it('num retorna descritor com kind number', () => {
      const d = num('FOO');
      expect(d.kind).toBe('number');
    });

    it('bool retorna descritor com kind boolean', () => {
      const d = bool('FOO');
      expect(d.kind).toBe('boolean');
    });

    it('enumVar retorna descritor com values e kind enum', () => {
      const d = enumVar('FOO', ['a', 'b', 'c'] as const);
      expect(d.kind).toBe('enum');
      expect(d.values).toEqual(['a', 'b', 'c']);
    });
  });

  describe('loadConfig — string', () => {
    it('lê env var string', () => {
      process.env.TEST_STR = 'hello';
      const cfg = loadConfig('t1', { name: str('TEST_STR') });
      expect(cfg.name).toBe('hello');
    });

    it('usa default quando env var ausente', () => {
      const cfg = loadConfig('t2', { name: str('TEST_STR', { default: 'fallback' }) });
      expect(cfg.name).toBe('fallback');
    });

    it('retorna undefined quando sem default e não-required', () => {
      const cfg = loadConfig('t3', { name: str('TEST_STR') });
      expect(cfg.name).toBeUndefined();
    });

    it('lança erro quando required e ausente', () => {
      expect(() => loadConfig('t4', { name: str('TEST_REQUIRED', { required: true }) })).toThrow(
        /env var obrigatória ausente: TEST_REQUIRED/,
      );
    });
  });

  describe('loadConfig — number', () => {
    it('parseia número', () => {
      process.env.TEST_NUM = '5442';
      const cfg = loadConfig('t5', { port: num('TEST_NUM') });
      expect(cfg.port).toBe(5442);
    });

    it('parseia número negativo', () => {
      process.env.TEST_NUM = '-1';
      const cfg = loadConfig('t6', { port: num('TEST_NUM') });
      expect(cfg.port).toBe(-1);
    });

    it('parseia float', () => {
      process.env.TEST_NUM = '3.14';
      const cfg = loadConfig('t7', { port: num('TEST_NUM') });
      expect(cfg.port).toBe(3.14);
    });

    it('lança erro quando valor não é número finito', () => {
      process.env.TEST_NUM = 'NaN';
      expect(() => loadConfig('t8', { port: num('TEST_NUM') })).toThrow(/não é número/);
    });

    it('lança erro quando valor não é número', () => {
      process.env.TEST_NUM = 'abc';
      expect(() => loadConfig('t9', { port: num('TEST_NUM') })).toThrow(/não é número/);
    });

    it('usa default quando ausente', () => {
      const cfg = loadConfig('t10', { port: num('TEST_NUM', { default: 8080 }) });
      expect(cfg.port).toBe(8080);
    });
  });

  describe('loadConfig — boolean', () => {
    it('"true" é true', () => {
      process.env.TEST_BOOL = 'true';
      const cfg = loadConfig('t11', { enabled: bool('TEST_BOOL') });
      expect(cfg.enabled).toBe(true);
    });

    it('"1" é true', () => {
      process.env.TEST_BOOL = '1';
      const cfg = loadConfig('t12', { enabled: bool('TEST_BOOL') });
      expect(cfg.enabled).toBe(true);
    });

    it('"false" é false', () => {
      process.env.TEST_BOOL = 'false';
      const cfg = loadConfig('t13', { enabled: bool('TEST_BOOL') });
      expect(cfg.enabled).toBe(false);
    });

    it('"0" é false', () => {
      process.env.TEST_BOOL = '0';
      const cfg = loadConfig('t14', { enabled: bool('TEST_BOOL') });
      expect(cfg.enabled).toBe(false);
    });

    it('"yes" é false (não é "true" nem "1")', () => {
      process.env.TEST_BOOL = 'yes';
      const cfg = loadConfig('t15', { enabled: bool('TEST_BOOL') });
      expect(cfg.enabled).toBe(false);
    });

    it('usa default quando ausente', () => {
      const cfg = loadConfig('t16', { enabled: bool('TEST_BOOL', { default: true }) });
      expect(cfg.enabled).toBe(true);
    });
  });

  describe('loadConfig — enum', () => {
    it('aceita valor da lista', () => {
      process.env.TEST_ENUM = 'shopee';
      const cfg = loadConfig('t17', {
        mp: enumVar('TEST_ENUM', ['shopee', 'mercadolivre', 'amazon'] as const),
      });
      expect(cfg.mp).toBe('shopee');
    });

    it('lança erro quando valor não está na lista', () => {
      process.env.TEST_ENUM = 'desconhecido';
      expect(() =>
        loadConfig('t18', {
          mp: enumVar('TEST_ENUM', ['shopee', 'mercadolivre'] as const),
        }),
      ).toThrow(/não está em \[shopee, mercadolivre\]/);
    });
  });

  describe('singleton cache', () => {
    it('segunda chamada retorna mesmo objeto', () => {
      const cfg1 = loadConfig('cache1', { name: str('TEST_STR', { default: 'a' }) });
      const cfg2 = loadConfig('cache1', { name: str('TEST_STR', { default: 'b' }) });
      // O segundo carregamento ignora o schema novo e retorna cache
      expect(cfg1.name).toBe('a');
      expect(cfg2.name).toBe('a');
    });

    it('resetConfigForTest reseta o cache do service', () => {
      const cfg1 = loadConfig('cache2', { name: str('TEST_STR', { default: 'a' }) });
      expect(cfg1.name).toBe('a');

      process.env.TEST_STR = 'changed';
      resetConfigForTest('cache2');

      const cfg2 = loadConfig('cache2', { name: str('TEST_STR', { default: 'b' }) });
      expect(cfg2.name).toBe('changed');
    });

    it('resetConfigForTest() sem args reseta todos os caches', () => {
      loadConfig('cache3', { name: str('TEST_STR', { default: 'a' }) });
      resetConfigForTest();

      const cfg = loadConfig('cache3', { name: str('TEST_STR', { default: 'b' }) });
      expect(cfg.name).toBe('b');
    });
  });

  describe('schema misto', () => {
    it('lê múltiplas env vars com tipos diferentes', () => {
      process.env.TEST_STR = 'hello';
      process.env.TEST_NUM = '5442';
      process.env.TEST_BOOL = 'true';
      process.env.TEST_ENUM = 'shopee';

      const cfg = loadConfig('mixed', {
        name: str('TEST_STR'),
        port: num('TEST_NUM'),
        enabled: bool('TEST_BOOL'),
        mp: enumVar('TEST_ENUM', ['shopee', 'mercadolivre'] as const),
      });

      expect(cfg.name).toBe('hello');
      expect(cfg.port).toBe(5442);
      expect(cfg.enabled).toBe(true);
      expect(cfg.mp).toBe('shopee');
    });
  });
});
