/**
 * Testes das funções PURAS do repositório de usuários.
 *
 * Cobrem o mapeamento para dados públicos (remoção de password_hash) e
 * o bootstrap de admin via ADMIN_EMAILS — sem PostgreSQL.
 */
import { describe, expect, it } from 'bun:test';
import { isEmailAdminAllowed, toUserPublic } from './users-pure.ts';

function makeUser(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    email: 'a@b.com',
    name: 'Matheus',
    isAdmin: false,
    passwordHash: 'secret-hash',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-02-01'),
    ...over,
  };
}

describe('toUserPublic', () => {
  it('remove password_hash', () => {
    const pub = toUserPublic(makeUser());
    expect('passwordHash' in pub).toBe(false);
  });

  it('preserva campos públicos', () => {
    const pub = toUserPublic(makeUser());
    expect(pub).toEqual({
      id: 1,
      email: 'a@b.com',
      name: 'Matheus',
      isAdmin: false,
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-02-01'),
    });
  });

  it('preserva isAdmin quando true', () => {
    const pub = toUserPublic(makeUser({ isAdmin: true }));
    expect(pub.isAdmin).toBe(true);
  });

  it('coerce isAdmin !== true para false (defesa contra dados sujos)', () => {
    const pub = toUserPublic(makeUser({ isAdmin: 'yes' as unknown as boolean }));
    expect(pub.isAdmin).toBe(false);
  });

  it('preserva campos mesmo com passwordHash vazio', () => {
    const pub = toUserPublic(makeUser({ passwordHash: '' }));
    expect(pub.id).toBe(1);
    expect(pub.email).toBe('a@b.com');
    expect('passwordHash' in pub).toBe(false);
  });

  it('nome vazio é preservado', () => {
    const pub = toUserPublic(makeUser({ name: '' }));
    expect(pub.name).toBe('');
  });
});

describe('isEmailAdminAllowed', () => {
  it('env undefined → false', () => {
    expect(isEmailAdminAllowed('foo@bar.com', undefined)).toBe(false);
  });

  it('env vazio → false', () => {
    expect(isEmailAdminAllowed('foo@bar.com', '')).toBe(false);
  });

  it('email único na lista, match exato → true', () => {
    expect(isEmailAdminAllowed('admin@x.com', 'admin@x.com')).toBe(true);
  });

  it('CSV com vários emails, match em qualquer → true', () => {
    expect(isEmailAdminAllowed('b@x.com', 'a@x.com, b@x.com , c@x.com')).toBe(true);
  });

  it('case-insensitive', () => {
    expect(isEmailAdminAllowed('ADMIN@X.COM', 'admin@x.com')).toBe(true);
    expect(isEmailAdminAllowed('admin@x.com', 'ADMIN@X.COM')).toBe(true);
  });

  it('match parcial (substring) não é aceito', () => {
    expect(isEmailAdminAllowed('admin@x.com.attacker.com', 'admin@x.com')).toBe(false);
  });

  it('email não está na lista → false', () => {
    expect(isEmailAdminAllowed('foo@bar.com', 'admin@x.com')).toBe(false);
  });

  it('entradas vazias na CSV são ignoradas', () => {
    expect(isEmailAdminAllowed('admin@x.com', ' , admin@x.com , ')).toBe(true);
    expect(isEmailAdminAllowed('foo@bar.com', ' , , ')).toBe(false);
  });
});
