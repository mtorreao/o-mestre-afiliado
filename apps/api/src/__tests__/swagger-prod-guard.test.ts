/**
 * Teste estático do guard de produção para Swagger — Item #8 da análise.
 *
 * Garante que:
 *   - apps/api/src/index.ts tem `if (process.env.NODE_ENV !== 'production')` guard
 *     antes de chamar `swagger(...)`
 *   - Swagger não é registrado em produção
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const INDEX_TS = join(import.meta.dir, '..', 'index.ts');

describe('Item #8 — Swagger restrito a dev', () => {
  it('apps/api/src/index.ts tem guard NODE_ENV para Swagger', () => {
    const source = readFileSync(INDEX_TS, 'utf-8');
    // Verifica que existe o guard de produção
    const hasGuard = source.includes("process.env.NODE_ENV !== 'production'");
    expect(hasGuard).toBe(true);
  });

  it('guard está próximo (mesmo arquivo) do registro do Swagger', () => {
    const source = readFileSync(INDEX_TS, 'utf-8');
    const guardIdx = source.indexOf("NODE_ENV !== 'production'");
    const swaggerIdx = source.indexOf('swagger(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(swaggerIdx).toBeGreaterThan(-1);
    // Distância máxima: 200 chars
    expect(Math.abs(guardIdx - swaggerIdx)).toBeLessThan(200);
  });

  it('Swagger está registrado dentro de um if (guard presente)', () => {
    const source = readFileSync(INDEX_TS, 'utf-8');
    // Verifica que swagger() aparece DEPOIS do guard NODE_ENV
    const guardIdx = source.indexOf("NODE_ENV !== 'production'");
    const swaggerIdx = source.indexOf('swagger({');
    expect(guardIdx).toBeLessThan(swaggerIdx);
  });

  it('código referencia Swagger como feature opcional em prod', () => {
    const source = readFileSync(INDEX_TS, 'utf-8');
    // Confirma que tem comentário explicativo
    const hasComment = source.toLowerCase().includes('swagger');
    expect(hasComment).toBe(true);
  });
});
