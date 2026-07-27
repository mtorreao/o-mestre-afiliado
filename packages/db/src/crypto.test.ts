/**
 * Testes do crypto AES-256-GCM em @omestre/db.
 *
 * Cobre:
 *  - encrypt/decrypt roundtrip com chave hex 32 bytes
 *  - encrypt/decrypt roundtrip com chave base64
 *  - encrypt/decrypt roundtrip com raw string (fallback SHA-256)
 *  - encrypt retorna null para entradas nulas/vazias
 *  - decrypt retorna null para entradas nulas/vazias
 *  - decrypt retorna null para payload inválido (muito curto)
 *  - cada encrypt gera IV diferente (resultados não-idênticos para mesmo input)
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { encrypt, decrypt, _resetKeyCache } from './crypto.ts';

// Gera uma chave hex de 64 caracteres (32 bytes)
const HEX_KEY = 'a'.repeat(64);
// Gera chave base64 de 44 caracteres (32 bytes)
const BASE64_KEY = Buffer.alloc(32, 0).toString('base64');

let consoleWarnSpy: ReturnType<typeof spyOn> | null = null;
const originalWarn = console.warn;

function spyOn<T extends typeof console.warn>(obj: T) {
  const spy = (...args: unknown[]) => {
    /* no-op */
  };
  obj = spy as unknown as T;
  return spy;
}

beforeEach(() => {
  // Limpa o cache da chave entre testes — sem isso, mudanças em
  // process.env.ENCRYPTION_KEY são ignoradas depois da primeira carga.
  _resetKeyCache();
});

describe('crypto.encrypt / crypto.decrypt', () => {
  beforeEach(() => {
    consoleWarnSpy = spyOn(console.warn);
  });
  afterEach(() => {
    console.warn = originalWarn;
    consoleWarnSpy = null;
  });

  describe('roundtrip com chave hex', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = HEX_KEY;
    });

    it('criptografa e descriptografa texto simples', () => {
      const enc = encrypt('hello world');
      expect(enc).not.toBeNull();
      expect(enc).not.toBe('hello world');

      const dec = decrypt(enc!);
      expect(dec).toBe('hello world');
    });

    it('preserva caracteres especiais e UTF-8', () => {
      const enc = encrypt('ãéîõü çñ 中文 🚀');
      const dec = decrypt(enc!);
      expect(dec).toBe('ãéîõü çñ 中文 🚀');
    });

    it('preserva quebras de linha', () => {
      const enc = encrypt('linha 1\nlinha 2\nlinha 3');
      expect(decrypt(enc!)).toBe('linha 1\nlinha 2\nlinha 3');
    });

    it('gera ciphertext diferente a cada chamada (IV aleatório)', () => {
      const a = encrypt('mesma entrada');
      const b = encrypt('mesma entrada');
      expect(a).not.toBe(b);
      // Mas ambos descriptografam para o mesmo plaintext
      expect(decrypt(a!)).toBe('mesma entrada');
      expect(decrypt(b!)).toBe('mesma entrada');
    });

    it('aceita chave hex com case mixto', () => {
      process.env.ENCRYPTION_KEY = 'A'.repeat(32) + 'b'.repeat(32);
      const enc = encrypt('teste');
      expect(decrypt(enc!)).toBe('teste');
    });
  });

  describe('roundtrip com chave base64', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = BASE64_KEY;
    });

    it('criptografa e descriptografa com chave base64', () => {
      const enc = encrypt('base64-key-test');
      expect(decrypt(enc!)).toBe('base64-key-test');
    });
  });

  describe('roundtrip com chave raw (fallback SHA-256)', () => {
    beforeEach(() => {
      // String que não é hex nem base64 → cai no fallback SHA-256
      process.env.ENCRYPTION_KEY = 'chave-em-texto-puro';
    });

    it('funciona via fallback SHA-256', () => {
      const enc = encrypt('raw-key');
      expect(decrypt(enc!)).toBe('raw-key');
    });
  });

  describe('entradas nulas/vazias', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = HEX_KEY;
    });

    it('encrypt retorna null para null', () => {
      expect(encrypt(null)).toBeNull();
    });

    it('encrypt retorna null para undefined', () => {
      expect(encrypt(undefined)).toBeNull();
    });

    it('encrypt retorna null para string vazia', () => {
      expect(encrypt('')).toBeNull();
    });

    it('decrypt retorna null para null', () => {
      expect(decrypt(null)).toBeNull();
    });

    it('decrypt retorna null para undefined', () => {
      expect(decrypt(undefined)).toBeNull();
    });

    it('decrypt retorna null para string vazia', () => {
      expect(decrypt('')).toBeNull();
    });
  });

  describe('payload inválido', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = HEX_KEY;
    });

    it('decrypt retorna null para payload muito curto', () => {
      // 12 (IV) + 16 (auth tag) + 1 (ciphertext mínimo) = 29 bytes
      // Menos que isso deve retornar null com warning
      const tooShort = Buffer.alloc(10).toString('base64');
      expect(decrypt(tooShort)).toBeNull();
    });

    it('decrypt retorna null para base64 inválido', () => {
      expect(decrypt('!!!not-base64!!!')).toBeNull();
    });

    it('decrypt retorna null para ciphertext adulterado', () => {
      const enc = encrypt('dados importantes');
      // Modifica o último caractere (afeta o ciphertext)
      const tampered = enc!.slice(0, -2) + (enc!.endsWith('A') ? 'B' : 'A');
      expect(decrypt(tampered)).toBeNull();
    });
  });

  describe('mudança de chave', () => {
    it('decrypt com chave diferente retorna null', () => {
      process.env.ENCRYPTION_KEY = HEX_KEY;
      _resetKeyCache();
      const enc = encrypt('segredo');

      process.env.ENCRYPTION_KEY = 'b'.repeat(64);
      _resetKeyCache();
      expect(decrypt(enc!)).toBeNull();
    });
  });

  describe('ausência de chave', () => {
    beforeEach(() => {
      delete process.env.ENCRYPTION_KEY;
    });

    it('encrypt lança erro descritivo quando ENCRYPTION_KEY não está configurada', () => {
      expect(() => encrypt('teste')).toThrow(/ENCRYPTION_KEY não configurada/);
    });

    it('encrypt lança erro com sugestão de como gerar a chave', () => {
      expect(() => encrypt('teste')).toThrow(/openssl rand -hex 32/);
    });
  });

  describe('cenários reais de uso', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = HEX_KEY;
    });

    it('roundtrip de session cookies ML', () => {
      const cookies = 'session_id=abc123; csrf_token=xyz789; user_id=42';
      const enc = encrypt(cookies);
      expect(decrypt(enc!)).toBe(cookies);
    });

    it('roundtrip de access_token', () => {
      const token = 'APP_USR-1234567890-abcdef-token-value';
      const enc = encrypt(token);
      expect(decrypt(enc!)).toBe(token);
    });

    it('roundtrip de JSON serializado', () => {
      const json = JSON.stringify({
        session_id: 'abc',
        cookies: [{ name: 'session_id', value: 'xyz' }],
      });
      const enc = encrypt(json);
      const dec = decrypt(enc!);
      expect(JSON.parse(dec!)).toEqual({
        session_id: 'abc',
        cookies: [{ name: 'session_id', value: 'xyz' }],
      });
    });
  });
});
