/**
 * Testes de autenticação — parseBasicAuth, safeEqual, sessões.
 */

import { describe, expect, test } from 'bun:test';
import {
  createSession,
  destroySession,
  hashPassword,
  isValidSession,
  parseBasicAuth,
  safeEqual,
  sha256Hex,
  verifyPassword,
} from './auth.ts';

describe('parseBasicAuth', () => {
  test('parse válido (user:pass)', () => {
    const header = 'Basic ' + Buffer.from('admin:senha123').toString('base64');
    expect(parseBasicAuth(header)).toEqual({ user: 'admin', password: 'senha123' });
  });

  test('aceita senha com dois-pontos', () => {
    const header = 'Basic ' + Buffer.from('admin:se:nha').toString('base64');
    expect(parseBasicAuth(header)).toEqual({ user: 'admin', password: 'se:nha' });
  });

  test('retorna null sem prefixo Basic', () => {
    expect(parseBasicAuth('Bearer abc')).toBeNull();
    expect(parseBasicAuth(undefined)).toBeNull();
  });

  test('retorna null para base64 inválido', () => {
    expect(parseBasicAuth('Basic !!!not-base64!!!')).toBeNull();
  });

  test('retorna null se não tem dois-pontos', () => {
    const header = 'Basic ' + Buffer.from('semcolon').toString('base64');
    expect(parseBasicAuth(header)).toBeNull();
  });
});

describe('safeEqual', () => {
  test('iguais → true', () => {
    expect(safeEqual('admin', 'admin')).toBe(true);
  });

  test('diferentes → false', () => {
    expect(safeEqual('admin', 'Admin')).toBe(false);
  });

  test('comprimentos diferentes → false (sem throw)', () => {
    expect(safeEqual('a', 'ab')).toBe(false);
  });

  test('vazios → true', () => {
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('sha256Hex', () => {
  test('hash estável de string conhecida', () => {
    // sha256("") — valor de referência conhecido.
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('hashPassword / verifyPassword (argon2id)', () => {
  test('hash gera formato $argon2id$', async () => {
    const hash = await hashPassword('senha-forte-123');
    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  test('verify aceita senha correta', async () => {
    const hash = await hashPassword('senha-forte-123');
    expect(await verifyPassword('senha-forte-123', hash)).toBe(true);
  });

  test('verify rejeita senha errada', async () => {
    const hash = await hashPassword('senha-forte-123');
    expect(await verifyPassword('senha-errada', hash)).toBe(false);
  });
});

describe('sessões', () => {
  test('createSession gera token e valida', () => {
    const token = createSession();
    expect(token).toHaveLength(64);
    expect(isValidSession(token)).toBe(true);
  });

  test('destroySession invalida', () => {
    const token = createSession();
    destroySession(token);
    expect(isValidSession(token)).toBe(false);
  });

  test('token inexistente → false', () => {
    expect(isValidSession('token-que-nao-existe')).toBe(false);
  });
});
