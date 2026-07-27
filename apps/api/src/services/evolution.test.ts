/**
 * Testes do cliente Evolution API em apps/api.
 *
 * Cobre as funções puras (sem I/O):
 *  - instanceNameFromUserId(userId): formata nome da instância
 *  - userIdFromInstanceName(name): extrai userId do nome
 *
 * Os calls HTTP (createInstance, getQrCode, etc.) dependem de fetch
 * mockado + globals da Evolution — cobertos indiretamente via
 * testes E2E futuros.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { config } from '../config.ts';
import { instanceNameFromUserId, userIdFromInstanceName } from './evolution.ts';

describe('instanceNameFromUserId', () => {
  it('formata como "user-{userId}"', () => {
    expect(instanceNameFromUserId(123)).toBe('user-123');
  });

  it('funciona com userId 0', () => {
    expect(instanceNameFromUserId(0)).toBe('user-0');
  });

  it('funciona com userId grande', () => {
    expect(instanceNameFromUserId(999999)).toBe('user-999999');
  });

  it('inversa: instanceNameFromUserId(userIdFromInstanceName(n)) === n', () => {
    for (const n of [1, 42, 100, 1234]) {
      expect(parseInt(userIdFromInstanceName(instanceNameFromUserId(n))!.toString(), 10)).toBe(n);
    }
  });
});

describe('userIdFromInstanceName', () => {
  it('extrai userId de "user-N"', () => {
    expect(userIdFromInstanceName('user-123')).toBe(123);
  });

  it('retorna null para nome fora do padrão', () => {
    expect(userIdFromInstanceName('not-user-123')).toBeNull();
  });

  it('retorna null para nome sem número', () => {
    expect(userIdFromInstanceName('user-')).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(userIdFromInstanceName('')).toBeNull();
  });

  it('extrai userId grande', () => {
    expect(userIdFromInstanceName('user-999999999')).toBe(999999999);
  });

  it('retorna null para nome com sufixo extra (formato estrito)', () => {
    // O regex exige o formato exato ^user-\d+$ — sufixos viram null.
    // Isso é desejável: nomes que não seguem o padrão user-N não são
    // afiliados válidos do sistema.
    expect(userIdFromInstanceName('user-123-extra')).toBeNull();
  });

  it('retorna null para nome sem prefixo "user-"', () => {
    expect(userIdFromInstanceName('instance-123')).toBeNull();
  });
});

describe('config integration', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.EVOLUTION_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.EVOLUTION_API_KEY;
    } else {
      process.env.EVOLUTION_API_KEY = originalApiKey;
    }
    config.reset();
  });

  it('expõe config.EVOLUTION_API_KEY baseado no env', () => {
    process.env.EVOLUTION_API_KEY = 'minha-chave-teste-123';
    config.reset();
    expect(config.EVOLUTION_API_KEY).toBe('minha-chave-teste-123');
  });

  it('config.EVOLUTION_API_URL tem default localhost:5444', () => {
    delete process.env.EVOLUTION_API_URL;
    config.reset();
    expect(config.EVOLUTION_API_URL).toBe('http://localhost:5444');
  });
});
