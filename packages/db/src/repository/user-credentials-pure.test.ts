/**
 * Testes das funções PURAS do repositório de credenciais de usuário.
 *
 * Cobrem a construção do update (campos undefined omitidos) e do insert
 * (defaults null) — sem PostgreSQL.
 */
import { describe, expect, it } from 'bun:test';
import { buildCredentialsUpdate, buildCredentialsInsert } from './user-credentials-pure.ts';

describe('buildCredentialsUpdate', () => {
  it('inclui ambos quando informados (string)', () => {
    const u = buildCredentialsUpdate({ shopeeAppId: 'id1', shopeeAppSecret: 'sec1' });
    expect(u).toEqual({ shopeeAppId: 'id1', shopeeAppSecret: 'sec1' });
  });

  it('omite campos undefined', () => {
    const u = buildCredentialsUpdate({ shopeeAppId: 'id1' });
    expect(u).toEqual({ shopeeAppId: 'id1' });
    expect('shopeeAppSecret' in u).toBe(false);
  });

  it('preserva valores null (não são undefined)', () => {
    const u = buildCredentialsUpdate({ shopeeAppId: null, shopeeAppSecret: 'sec' });
    expect(u).toEqual({ shopeeAppId: null, shopeeAppSecret: 'sec' });
  });

  it('retorna {} quando nada informado', () => {
    expect(buildCredentialsUpdate({})).toEqual({});
  });

  it('atualiza apenas secret', () => {
    const u = buildCredentialsUpdate({ shopeeAppSecret: 'novo' });
    expect(u).toEqual({ shopeeAppSecret: 'novo' });
    expect('shopeeAppId' in u).toBe(false);
  });
});

describe('buildCredentialsInsert', () => {
  it('resolve userId e valores informados', () => {
    const i = buildCredentialsInsert(7, { shopeeAppId: 'id', shopeeAppSecret: 'sec' });
    expect(i).toEqual({ userId: 7, shopeeAppId: 'id', shopeeAppSecret: 'sec' });
  });

  it('undefined vira null (default da tabela)', () => {
    const i = buildCredentialsInsert(7, {});
    expect(i).toEqual({ userId: 7, shopeeAppId: null, shopeeAppSecret: null });
  });

  it('null explícito preservado', () => {
    const i = buildCredentialsInsert(7, { shopeeAppId: null });
    expect(i).toEqual({ userId: 7, shopeeAppId: null, shopeeAppSecret: null });
  });
});
