/**
 * Testes do helper de expiração JWT — Item #6 da análise.
 *
 * Garante:
 *   - exp = now + 604.800s (7 dias)
 *   - sempre retorna number (segundos, não ms)
 *   - é aditivo (não substitui)
 */
import { describe, expect, it } from 'bun:test';
import { buildJwtExpiry, JWT_EXPIRATION_SECONDS } from './jwt-expiry-pure.ts';

describe('buildJwtExpiry', () => {
  it('exp = now + 7 dias (604.800s)', () => {
    const now = 1_700_000_000_000; // ms
    const exp = buildJwtExpiry(now);
    expect(exp).toBe(Math.floor(now / 1000) + JWT_EXPIRATION_SECONDS);
    expect(exp).toBe(Math.floor(now / 1000) + 604_800);
  });

  it('sempre retorna número de segundos (não ms)', () => {
    const now = 1_700_000_000_000;
    const exp = buildJwtExpiry(now);
    // sanity: exp deve ser ~10 dígitos, não ~13
    expect(String(exp).length).toBeLessThanOrEqual(11);
  });

  it('é aditivo — soma constante ao tempo', () => {
    const a = buildJwtExpiry(1000);
    const b = buildJwtExpiry(2000);
    expect(b - a).toBe(1); // 1 segundo de diferença entre inputs
  });

  it('constante de 7 dias em segundos', () => {
    expect(JWT_EXPIRATION_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(JWT_EXPIRATION_SECONDS).toBe(604_800);
  });

  it('uso default de Date.now()', () => {
    const before = Math.floor(Date.now() / 1000);
    const exp = buildJwtExpiry();
    const after = Math.floor(Date.now() / 1000);
    expect(exp).toBeGreaterThan(before + JWT_EXPIRATION_SECONDS - 1);
    expect(exp).toBeLessThanOrEqual(after + JWT_EXPIRATION_SECONDS);
  });
});
