/**
 * Testes do resolver de JWT secret — Item #4 da análise.
 *
 * Garante:
 *   - JWT_SECRET configurada: usa a env var (não gera aleatório)
 *   - Sem JWT_SECRET em produção: lança erro (fail-closed)
 *   - Sem JWT_SECRET em dev: gera secret aleatório (token não persiste entre restarts)
 *   - Strings vazias: trata como não configurada
 */
import { describe, expect, it } from 'bun:test';
import { resolveJwtSecret } from './jwt-secret-pure.ts';

describe('resolveJwtSecret', () => {
  it('com JWT_SECRET configurada → usa a env var', () => {
    const result = resolveJwtSecret('minha-chave-secreta', 'production');
    expect(result.secret).toBe('minha-chave-secreta');
    expect(result.isRandomDev).toBe(false);
  });

  it('em produção sem JWT_SECRET → lança erro', () => {
    expect(() => resolveJwtSecret('', 'production')).toThrowError(
      /JWT_SECRET is required in production/,
    );
  });

  it('em produção com NODE_ENV undefined → gera aleatório (trata como dev)', () => {
    // NODE_ENV undefined = dev. Como protection extra, o secret hardcoded
    // antigo nunca é retornado.
    const result = resolveJwtSecret(undefined, undefined);
    expect(result.isRandomDev).toBe(true);
    expect(result.secret).not.toBe('omestre-dev-secret-change-in-production');
  });

  it('em dev sem JWT_SECRET → gera secret aleatório', () => {
    const result = resolveJwtSecret('', 'development');
    expect(result.secret).toBeTruthy();
    expect(result.secret.length).toBeGreaterThan(10);
    expect(result.isRandomDev).toBe(true);
  });

  it('em dev com NODE_ENV="test" → gera secret aleatório', () => {
    const result = resolveJwtSecret(undefined, 'test');
    expect(result.isRandomDev).toBe(true);
  });

  it('em dev sem NODE_ENV (undefined) → gera secret aleatório (seguro)', () => {
    const result = resolveJwtSecret(undefined, undefined);
    // Em test runs NODE_ENV pode ser 'test', então precisamos cobrir AMBOS
    if (process.env.NODE_ENV !== 'production') {
      expect(result.isRandomDev).toBe(true);
    }
  });

  it('cada chamada em dev gera secret diferente', () => {
    const a = resolveJwtSecret('', 'development');
    const b = resolveJwtSecret('', 'development');
    expect(a.secret).not.toBe(b.secret);
    expect(a.isRandomDev).toBe(true);
    expect(b.isRandomDev).toBe(true);
  });

  it('JWT_SECRET undefined em prod é o mesmo que string vazia (fail-closed)', () => {
    expect(() => resolveJwtSecret(undefined, 'production')).toThrowError(/JWT_SECRET is required/);
  });

  it('secret hardcoded antigo NÃO é mais usado', () => {
    // O bug original era usar 'omestre-dev-secret-change-in-production' como fallback.
    // Verificamos que esse string nunca aparece, mesmo em dev sem env var.
    const result = resolveJwtSecret('', 'development');
    expect(result.secret).not.toBe('omestre-dev-secret-change-in-production');
    expect(result.secret).not.toContain('change-in-production');
  });
});
