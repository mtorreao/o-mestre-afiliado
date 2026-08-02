import { describe, expect, it } from 'bun:test';
import {
  ACCESS_TOKEN_SECONDS,
  REFRESH_TOKEN_SECONDS,
  buildAccessTokenExpiry,
  buildRefreshTokenExpiry,
  generateRefreshToken,
  hashRefreshToken,
  issueRefreshToken,
  newFamilyId,
} from './token-pure.ts';

describe('token-pure', () => {
  it('ACCESS_TOKEN_SECONDS = 1h = 3600', () => {
    expect(ACCESS_TOKEN_SECONDS).toBe(3600);
  });

  it('REFRESH_TOKEN_SECONDS = 30d = 2_592_000', () => {
    expect(REFRESH_TOKEN_SECONDS).toBe(2_592_000);
  });

  it('buildAccessTokenExpiry = now + 1h (10 dígitos)', () => {
    const now = Date.now();
    const exp = buildAccessTokenExpiry(now);
    expect(exp).toBe(Math.floor(now / 1000) + 3600);
    expect(String(exp).length).toBeLessThanOrEqual(11);
  });

  it('buildRefreshTokenExpiry = now + 30d', () => {
    const now = Date.now();
    const exp = buildRefreshTokenExpiry(now);
    expect(exp).toBe(Math.floor(now / 1000) + 2_592_000);
  });

  it('generateRefreshToken -> 64 hex chars', () => {
    const t = generateRefreshToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashRefreshToken determinístico e diferencia tokens', () => {
    const a = hashRefreshToken('token-a');
    const b = hashRefreshToken('token-a');
    const c = hashRefreshToken('token-b');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('newFamilyId -> UUID válido', () => {
    expect(newFamilyId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('issueRefreshToken gera token opaco, hash, familia e expiresAt', () => {
    const now = Date.now();
    const issue = issueRefreshToken(now);
    expect(issue.token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(issue.token)).toBe(issue.hash);
    expect(issue.familyId).toMatch(/[0-9a-f-]{36}/);
    expect(issue.expiresAt.getTime()).toBeGreaterThan(now);
  });

  it('issueRefreshToken aceita familyId fornecido (rotação)', () => {
    const issue = issueRefreshToken(Date.now(), 'fam-x');
    expect(issue.familyId).toBe('fam-x');
  });
});
