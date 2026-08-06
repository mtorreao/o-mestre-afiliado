import { describe, expect, it } from 'bun:test';
import { isSuperAdmin } from './super-admin.ts';

describe('isSuperAdmin', () => {
  it('aceita quando is_admin=true', () => {
    expect(isSuperAdmin(true)).toBe(true);
  });

  it('rejeita quando is_admin=false', () => {
    expect(isSuperAdmin(false)).toBe(false);
  });

  it('coerce isAdmin !== true para false (defesa contra dados sujos)', () => {
    expect(isSuperAdmin('yes' as unknown as boolean)).toBe(false);
  });
});
