import { describe, expect, it } from 'bun:test';
import { isSuperAdmin } from './super-admin.ts';

describe('isSuperAdmin', () => {
  it('exige is_admin=true e email presente em ADMIN_EMAILS', () => {
    expect(isSuperAdmin(true, 'ADMIN@example.com', 'other@example.com, admin@example.com')).toBe(
      true,
    );
  });

  it('rejeita is_admin=true quando email não está em ADMIN_EMAILS', () => {
    expect(isSuperAdmin(true, 'mtorreao1@gmail.com', 'admin@omestreafiliado.com.br')).toBe(false);
  });

  it('rejeita email permitido quando is_admin=false', () => {
    expect(isSuperAdmin(false, 'admin@example.com', 'admin@example.com')).toBe(false);
  });
});
