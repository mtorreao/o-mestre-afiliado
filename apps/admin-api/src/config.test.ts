/**
 * Testes de config — validação de env obrigatórias e defaults.
 */

import { describe, expect, test } from 'bun:test';
import { loadConfig, makeLogger } from './config.ts';

const BASE_ENV: Record<string, string> = {
  OMA_ADMIN_USER: 'admin',
  OMA_ADMIN_PASSWORD_HASH: '$argon2id$hash',
  OMA_DEPLOY_PUBLIC_KEY: 'pubkey',
  OMA_DEPLOY_SCRIPT: '/scripts/deploy-prod.sh',
  TELEGRAM_BOT_TOKEN: 'tok',
  TELEGRAM_CHAT_ID: '123',
};

describe('loadConfig', () => {
  test('carrega com env completo', () => {
    const cfg = loadConfig({ ...BASE_ENV });
    expect(cfg.port).toBe(9090);
    expect(cfg.adminUser).toBe('admin');
    expect(cfg.deployTimeoutMs).toBe(600000);
    expect(cfg.deployStateDir).toBe('/var/lib/oma');
  });

  test('aplica defaults e overrides', () => {
    const cfg = loadConfig({
      ...BASE_ENV,
      ADMIN_API_PORT: '9191',
      OMA_DEPLOY_TIMEOUT_MS: '120000',
      OMA_DEPLOY_STATE_DIR: '/tmp/state',
      OMA_LOG_LEVEL: 'debug',
    });
    expect(cfg.port).toBe(9191);
    expect(cfg.deployTimeoutMs).toBe(120000);
    expect(cfg.deployStateDir).toBe('/tmp/state');
    expect(cfg.logLevel).toBe('debug');
  });

  test('lança erro se faltar env obrigatória', () => {
    const missing = { ...BASE_ENV };
    delete missing['TELEGRAM_BOT_TOKEN'];
    expect(() => loadConfig(missing)).toThrow(/TELEGRAM_BOT_TOKEN/);
  });

  test('lança erro listando todas as faltantes', () => {
    expect(() => loadConfig({})).toThrow(/OMA_ADMIN_USER.*OMA_ADMIN_PASSWORD_HASH/s);
  });

  test('rejeita env vazio (whitespace)', () => {
    const blank = { ...BASE_ENV, OMA_ADMIN_USER: '   ' };
    expect(() => loadConfig(blank)).toThrow(/OMA_ADMIN_USER/);
  });

  test('config é congelada (Object.freeze)', () => {
    const cfg = loadConfig({ ...BASE_ENV });
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});

describe('makeLogger', () => {
  test('respeita nível (warn não loga info)', () => {
    const log = makeLogger('warn');
    const original = process.stdout.write;
    let output = '';
    process.stdout.write = (chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    };
    try {
      log.info('mensagem info');
      log.warn('mensagem warn');
      expect(output).not.toContain('mensagem info');
      expect(output).toContain('mensagem warn');
    } finally {
      process.stdout.write = original;
    }
  });

  test('formato JSON estruturado', () => {
    const log = makeLogger('debug');
    const original = process.stdout.write;
    let output = '';
    process.stdout.write = (chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    };
    try {
      log.debug('teste', { chave: 'valor' });
      const parsed = JSON.parse(output.trim()) as Record<string, unknown>;
      expect(parsed['level']).toBe('debug');
      expect(parsed['msg']).toBe('teste');
      expect(parsed['chave']).toBe('valor');
    } finally {
      process.stdout.write = original;
    }
  });
});
