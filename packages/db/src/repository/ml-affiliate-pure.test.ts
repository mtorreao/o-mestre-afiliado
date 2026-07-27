/**
 * Testes das funções PURAS do repositório de afiliados Mercado Livre.
 *
 * Cobrem cálculo de expiração e construção de sumário (sem DB/crypto).
 */
import { describe, expect, it } from 'bun:test';
import type { MlAffiliate } from './mlAffiliates.repository.ts';
import { computeExpiresAt, isMlTokenExpired, toMlSummaryPure } from './ml-affiliate-pure.ts';

function makeAffiliate(over: Partial<MlAffiliate> = {}): MlAffiliate {
  return {
    id: 1,
    mlUserId: 'MLB123',
    nickname: 'Matheus',
    accessToken: 'at',
    refreshToken: 'rt',
    expiresAt: new Date('2030-01-01'),
    connectedAt: new Date('2024-01-01'),
    lastUsedAt: new Date('2024-02-01'),
    userId: 99,
    meliid: 'abc',
    melitat: 'mtag',
    sessionCookies: 'enc',
    ...over,
  } as MlAffiliate;
}

describe('computeExpiresAt', () => {
  it('soma expiresIn segundos a now', () => {
    const exp = computeExpiresAt(3600, 1_000_000);
    expect(exp.getTime()).toBe(1_000_000 + 3600 * 1000);
  });

  it('usa Date.now() quando now não informado', () => {
    const before = Date.now();
    const exp = computeExpiresAt(10);
    const after = Date.now();
    expect(exp.getTime()).toBeGreaterThanOrEqual(before + 10_000);
    expect(exp.getTime()).toBeLessThanOrEqual(after + 10_000);
  });
});

describe('isMlTokenExpired', () => {
  it('retorna false quando expiresAt está no futuro', () => {
    expect(isMlTokenExpired(new Date(2_000_000), 1_000_000)).toBe(false);
  });

  it('retorna true quando expiresAt está no passado', () => {
    expect(isMlTokenExpired(new Date(500_000), 1_000_000)).toBe(true);
  });

  it('retorna false exatamente no limite (não expirado ainda)', () => {
    expect(isMlTokenExpired(new Date(1_000_000), 1_000_000)).toBe(false);
  });
});

describe('toMlSummaryPure', () => {
  const now = new Date('2024-06-01').getTime();

  it('mapeia campos do afiliado', () => {
    const s = toMlSummaryPure(makeAffiliate(), now);
    expect(s.mlUserId).toBe('MLB123');
    expect(s.nickname).toBe('Matheus');
    expect(s.meliid).toBe('abc');
    expect(s.melitat).toBe('mtag');
  });

  it('hasSessionCookies true quando sessionCookies presente', () => {
    expect(toMlSummaryPure(makeAffiliate({ sessionCookies: 'x' }), now).hasSessionCookies).toBe(
      true,
    );
  });

  it('hasSessionCookies false quando sessionCookies nulo', () => {
    expect(toMlSummaryPure(makeAffiliate({ sessionCookies: null }), now).hasSessionCookies).toBe(
      false,
    );
  });

  it('expired false quando expiresAt no futuro', () => {
    expect(toMlSummaryPure(makeAffiliate({ expiresAt: new Date('2030-01-01') }), now).expired).toBe(
      false,
    );
  });

  it('expired true quando expiresAt no passado', () => {
    expect(toMlSummaryPure(makeAffiliate({ expiresAt: new Date('2020-01-01') }), now).expired).toBe(
      true,
    );
  });

  it('preserva connectedAt e lastUsedAt', () => {
    const s = toMlSummaryPure(makeAffiliate(), now);
    expect(s.connectedAt).toEqual(new Date('2024-01-01'));
    expect(s.lastUsedAt).toEqual(new Date('2024-02-01'));
  });
});
