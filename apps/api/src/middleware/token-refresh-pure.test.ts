import { describe, expect, it } from 'bun:test';
import { classifyRefreshToken } from './token-refresh-pure.ts';
import type { RefreshRowLike } from './token-refresh-pure.ts';

const now = 1_800_000_000_000; // fixed ms
const future = new Date(now + 60_000);
const past = new Date(now - 60_000);

function row(over: Partial<RefreshRowLike> = {}): RefreshRowLike {
  return { revokedAt: null, expiresAt: future, ...over };
}

describe('classifyRefreshToken', () => {
  it('linha null → not_found', () => {
    expect(classifyRefreshToken(null, now)).toBe('not_found');
  });

  it('vivo e não revogado → valid', () => {
    expect(classifyRefreshToken(row(), now)).toBe('valid');
  });

  it('revogado e ainda no prazo → replay', () => {
    expect(classifyRefreshToken(row({ revokedAt: new Date(now - 1000) }), now)).toBe('replay');
  });

  it('expirado (não revogado) → expired', () => {
    expect(classifyRefreshToken(row({ expiresAt: past }), now)).toBe('expired');
  });

  it('revogado e expirado → expired (precedência)', () => {
    expect(
      classifyRefreshToken(row({ revokedAt: new Date(now - 1000), expiresAt: past }), now),
    ).toBe('expired');
  });
});
