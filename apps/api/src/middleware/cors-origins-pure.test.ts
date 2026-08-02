/**
 * Testes do resolver de origens CORS — Item #5 da análise.
 *
 * Garante:
 *   - Em produção: apenas FRONTEND_URL é permitida
 *   - Em dev: FRONTEND_URL + portas locais comuns
 *   - Sem FRONTEND_URL em produção: lista vazia (CORS bloqueia TUDO)
 *   - Sem FRONTEND_URL em dev: ainda permite localhost comuns
 *   - Sem duplicatas quando FRONTEND_URL está na lista de dev
 */
import { describe, expect, it } from 'bun:test';
import { getAllowedCorsOrigins } from './cors-origins-pure.ts';

describe('getAllowedCorsOrigins', () => {
  it('em produção: apenas FRONTEND_URL', () => {
    const origins = getAllowedCorsOrigins('https://app.example.com', 'production');
    expect(origins).toEqual(['https://app.example.com']);
  });

  it('em dev: FRONTEND_URL + portas comuns', () => {
    const origins = getAllowedCorsOrigins('http://localhost:5441', 'development');
    expect(origins[0]).toBe('http://localhost:5441');
    expect(origins).toContain('http://localhost:5173');
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://127.0.0.1:5441');
    expect(origins.length).toBeGreaterThan(3);
  });

  it('em produção sem FRONTEND_URL: lista vazia (bloqueia tudo)', () => {
    const origins = getAllowedCorsOrigins(undefined, 'production');
    expect(origins).toEqual([]);
  });

  it('em produção com FRONTEND_URL string vazia: lista vazia', () => {
    const origins = getAllowedCorsOrigins('', 'production');
    expect(origins).toEqual([]);
  });

  it('em dev sem FRONTEND_URL: ainda permite localhost', () => {
    const origins = getAllowedCorsOrigins(undefined, 'development');
    expect(origins).toContain('http://localhost:5441');
  });

  it('em dev sem NODE_ENV (undefined): trata como dev → permite localhost', () => {
    const origins = getAllowedCorsOrigins('http://x', undefined);
    expect(origins).toContain('http://localhost:5441');
  });

  it('em dev com NODE_ENV=test: permite localhost', () => {
    const origins = getAllowedCorsOrigins('http://x', 'test');
    expect(origins).toContain('http://localhost:5173');
  });

  it('sem duplicatas quando FRONTEND_URL coincide com dev', () => {
    const origins = getAllowedCorsOrigins('http://localhost:5441', 'development');
    const count = origins.filter((o) => o === 'http://localhost:5441').length;
    expect(count).toBe(1);
  });

  it('em produção: NÃO inclui portas de dev (mesmo que FRONTEND_URL bata)', () => {
    const origins = getAllowedCorsOrigins('http://localhost:5441', 'production');
    expect(origins).not.toContain('http://localhost:5173');
    expect(origins).not.toContain('http://localhost:3000');
  });
});
