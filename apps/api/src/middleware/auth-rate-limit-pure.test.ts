import { describe, expect, test } from 'bun:test';
import {
  getClientIp,
  IpRateLimiter,
  isRateLimitEnabled,
  LOGIN_MAX_REQUESTS,
  LOGIN_WINDOW_MS,
  RateLimitError,
  REGISTER_MAX_REQUESTS,
  REGISTER_WINDOW_MS,
} from './auth-rate-limit-pure.ts';

describe('IpRateLimiter', () => {
  test('permite até maxRequests dentro da janela', () => {
    const limiter = new IpRateLimiter({ maxRequests: 3, windowMs: 1000 });
    expect(() => limiter.check('1.2.3.4', 1000)).not.toThrow();
    expect(() => limiter.check('1.2.3.4', 1100)).not.toThrow();
    expect(() => limiter.check('1.2.3.4', 1200)).not.toThrow();
  });

  test('bloqueia ao exceder maxRequests', () => {
    const limiter = new IpRateLimiter({ maxRequests: 2, windowMs: 1000 });
    limiter.check('1.2.3.4', 1000);
    limiter.check('1.2.3.4', 1100);
    expect(() => limiter.check('1.2.3.4', 1200)).toThrow(RateLimitError);
  });

  test('RateLimitError inclui retryAfterMs', () => {
    const limiter = new IpRateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiter.check('1.2.3.4', 1000);
    try {
      limiter.check('1.2.3.4', 1500);
      throw new Error('should not reach');
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError);
      const e = err as RateLimitError;
      expect(e.code).toBe('rate-limit-exceeded');
      expect(e.retryAfterMs).toBeGreaterThan(0);
    }
  });

  test('permite novamente após janela passar', () => {
    const limiter = new IpRateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiter.check('1.2.3.4', 1000);
    expect(() => limiter.check('1.2.3.4', 2100)).not.toThrow();
  });

  test('separa contadores por IP', () => {
    const limiter = new IpRateLimiter({ maxRequests: 1, windowMs: 1000 });
    limiter.check('1.1.1.1', 1000);
    expect(() => limiter.check('2.2.2.2', 1000)).not.toThrow();
  });

  test('prune remove entradas expiradas', () => {
    const limiter = new IpRateLimiter({ maxRequests: 5, windowMs: 1000 });
    limiter.check('1.1.1.1', 1000);
    limiter.check('2.2.2.2', 1000);
    expect(limiter.hits.size).toBe(2);
    const removed = limiter.prune(3000);
    expect(removed).toBe(2);
    expect(limiter.hits.size).toBe(0);
  });

  test('prune mantém entradas ainda na janela', () => {
    const limiter = new IpRateLimiter({ maxRequests: 5, windowMs: 1000 });
    // 1.1.1.1: t=1000 (antigo) → deve ser removido
    limiter.check('1.1.1.1', 1000);
    // 2.2.2.2: t=2000 (recente) → deve ser mantido
    limiter.check('2.2.2.2', 2000);
    const removed = limiter.prune(2500);
    // cutoff = 2500 - 1000 = 1500. Só 1.1.1.1 está fora da janela (t=1000 < 1500).
    // 2.2.2.2 (t=2000 > 1500) é mantido.
    expect(removed).toBe(1);
    expect(limiter.hits.size).toBe(1);
    expect(limiter.hits.has('2.2.2.2')).toBe(true);
    expect(limiter.hits.has('1.1.1.1')).toBe(false);
  });
});

describe('getClientIp', () => {
  test('extrai primeiro IP de X-Forwarded-For', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1, 10.0.0.2' });
    expect(getClientIp(headers)).toBe('203.0.113.1');
  });

  test('cai para x-real-ip quando XFF ausente', () => {
    const headers = new Headers({ 'x-real-ip': '203.0.113.5' });
    expect(getClientIp(headers)).toBe('203.0.113.5');
  });

  test('retorna "unknown" sem nenhum header', () => {
    const headers = new Headers();
    expect(getClientIp(headers)).toBe('unknown');
  });

  test('XFF vazio cai para unknown', () => {
    const headers = new Headers({ 'x-forwarded-for': '' });
    expect(getClientIp(headers)).toBe('unknown');
  });
});

describe('constantes de rate limit', () => {
  test('login: 5 requests por minuto', () => {
    expect(LOGIN_MAX_REQUESTS).toBe(5);
    expect(LOGIN_WINDOW_MS).toBe(60_000);
  });

  test('register: 3 requests por hora', () => {
    expect(REGISTER_MAX_REQUESTS).toBe(3);
    expect(REGISTER_WINDOW_MS).toBe(3_600_000);
  });
});

describe('isRateLimitEnabled', () => {
  test('NODE_ENV=test → desabilitado (E2E cria muitos usuários do mesmo IP)', () => {
    expect(isRateLimitEnabled('test')).toBe(false);
  });

  test('NODE_ENV=production → habilitado', () => {
    expect(isRateLimitEnabled('production')).toBe(true);
  });

  test('NODE_ENV=development → habilitado', () => {
    expect(isRateLimitEnabled('development')).toBe(true);
  });

  test('NODE_ENV undefined → habilitado (default seguro)', () => {
    expect(isRateLimitEnabled(undefined)).toBe(true);
  });

  test('NODE_ENV vazio → habilitado', () => {
    expect(isRateLimitEnabled('')).toBe(true);
  });
});
