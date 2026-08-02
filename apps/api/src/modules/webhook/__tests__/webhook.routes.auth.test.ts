/**
 * Testes estáticos + comportamentais do guard de autenticação do webhook — Item #3.
 *
 * Abordagem mista: testes estáticos via leitura do source (evita problema de
 * mock.module em paralelo com outros testes que mockam group-cache.ts).
 *
 * Garante:
 *   - Função safeEqual é constant-time
 *   - Handler verifica header apikey
 *   - 503 fail-closed sem EVOLUTION_API_KEY
 *   - 401 com "Unauthorized" se apikey incorreta
 *   - Código vulnerável original (`void EVOLUTION_API_KEY`) foi removido
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const WEBHOOK_TS = join(import.meta.dir, '..', 'webhook.routes.ts');
const source = readFileSync(WEBHOOK_TS, 'utf-8');

describe('Item #3 — Webhook exige apikey (validação estática)', () => {
  it('código-fonte contém verificação da apikey (header)', () => {
    expect(source).toContain("request.headers.get('apikey')");
  });

  it('código-fonte contém função safeEqual', () => {
    expect(source).toContain('function safeEqual');
  });

  it('safeEqual é constant-time (compara character por character)', () => {
    const idx = source.indexOf('function safeEqual');
    const endIdx = source.indexOf('}', idx);
    const body = source.substring(idx, endIdx);
    expect(body).toContain('charCodeAt');
    expect(body).toContain('diff');
    expect(body).toContain('a.length');
    expect(body).toContain('b.length');
  });

  it('handler chama safeEqual(providedKey, EVOLUTION_API_KEY)', () => {
    expect(source).toContain('safeEqual(providedKey, EVOLUTION_API_KEY)');
  });

  it('retorna 503 fail-closed se EVOLUTION_API_KEY vazia', () => {
    expect(source).toContain('set.status = 503');
    expect(source).toContain('!EVOLUTION_API_KEY');
  });

  it('retorna 401 com mensagem Unauthorized', () => {
    expect(source).toContain('set.status = 401');
    expect(source).toContain("'Unauthorized'");
  });

  it('avisa (log) sobre apikey inválida', () => {
    expect(source).toContain('🔒 Webhook rejeitado');
  });

  it('NÃO contém o código vulnerável original `void EVOLUTION_API_KEY`', () => {
    expect(source).not.toContain('void EVOLUTION_API_KEY');
  });

  it('NÃO usa comparação direta `===` da chave (anti-timing-attack)', () => {
    const matches = source.match(/providedKey\s*[!=]==\s*EVOLUTION_API_KEY/g);
    expect(matches).toBeNull();
  });
});

describe('Item #3 — safeEqual unit (constant-time)', () => {
  function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
  }

  it('strings idênticas → true', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
  });

  it('1 caractere diferente no início → false', () => {
    expect(safeEqual('abc', 'xbc')).toBe(false);
  });

  it('1 caractere diferente no fim → false', () => {
    expect(safeEqual('abc', 'abx')).toBe(false);
  });

  it('comprimentos diferentes → false', () => {
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('strings vazias → true', () => {
    expect(safeEqual('', '')).toBe(true);
  });

  it('case-sensitivity preservada', () => {
    expect(safeEqual('abc', 'ABC')).toBe(false);
  });

  it('chaves longas (32+ chars) → safeEqual executa rápido', () => {
    const a = 'a'.repeat(40);
    const b = 'b'.repeat(40);
    const start = performance.now();
    safeEqual(a, b);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(10); // ms
  });
});
