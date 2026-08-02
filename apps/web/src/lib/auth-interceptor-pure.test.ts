import { describe, expect, it } from 'bun:test';
import { decideRefresh, isAuthEndpoint } from './auth-interceptor-pure.ts';

describe('auth-interceptor-pure', () => {
  it('reconhece endpoints de auth (sem Bearer/retry)', () => {
    expect(isAuthEndpoint('/api/auth/login')).toBe(true);
    expect(isAuthEndpoint('/api/auth/register')).toBe(true);
    expect(isAuthEndpoint('/api/auth/refresh')).toBe(true);
  });

  it('/me e demais APIs não são auth endpoints', () => {
    expect(isAuthEndpoint('/api/auth/me')).toBe(false);
    expect(isAuthEndpoint('/api/worker/status')).toBe(false);
  });

  it('401 + refresh token → deve refazer', () => {
    const d = decideRefresh({ status: 401, hasRefreshToken: true, url: '/api/mirrors' });
    expect(d.shouldRefresh).toBe(true);
  });

  it('401 sem refresh token → não tenta refresh', () => {
    const d = decideRefresh({ status: 401, hasRefreshToken: false, url: '/api/mirrors' });
    expect(d.shouldRefresh).toBe(false);
  });

  it('200 não dispara refresh', () => {
    const d = decideRefresh({ status: 200, hasRefreshToken: true, url: '/api/mirrors' });
    expect(d.shouldRefresh).toBe(false);
  });

  it('/me: 401 dispara refresh (reautentica silenciosamente)', () => {
    const d = decideRefresh({ status: 401, hasRefreshToken: true, url: '/api/auth/me' });
    expect(d.shouldRefresh).toBe(true);
  });
});
