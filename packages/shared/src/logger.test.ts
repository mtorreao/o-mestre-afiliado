/**
 * Testes do logger estruturado (makeLogger).
 *
 * Cobre:
 *  - formato JSON com timestamp ISO, level, service, message
 *  - data spread na raiz quando é objeto
 *  - data descartado quando é primitivo/array
 *  - level 'error' usa console.error, demais usam console.log
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { makeLogger } from './logger.ts';

describe('makeLogger', () => {
  let logCalls: string[];
  let errCalls: string[];
  let originalLog: typeof console.log;
  let originalErr: typeof console.error;

  beforeEach(() => {
    logCalls = [];
    errCalls = [];
    originalLog = console.log;
    originalErr = console.error;
    console.log = (...args: unknown[]) => {
      logCalls.push(args.join(' '));
    };
    console.error = (...args: unknown[]) => {
      errCalls.push(args.join(' '));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalErr;
  });

  it('formata como JSON com timestamp ISO + level + service + message', () => {
    const log = makeLogger('test-service');
    log('info', 'hello world');

    expect(logCalls).toHaveLength(1);
    const parsed = JSON.parse(logCalls[0]!);
    expect(parsed.level).toBe('info');
    expect(parsed.service).toBe('test-service');
    expect(parsed.message).toBe('hello world');
    // ISO 8601 — match simples
    expect(parsed.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('data objeto é spread na raiz', () => {
    const log = makeLogger('svc');
    log('info', 'with data', { foo: 'bar', count: 42 });

    const parsed = JSON.parse(logCalls[0]!);
    expect(parsed.foo).toBe('bar');
    expect(parsed.count).toBe(42);
    expect(parsed.message).toBe('with data');
    // data NÃO deve aparecer como campo aninhado
    expect(parsed.data).toBeUndefined();
  });

  it('data undefined não é incluído', () => {
    const log = makeLogger('svc');
    log('info', 'no data');
    const parsed = JSON.parse(logCalls[0]!);
    expect(parsed.message).toBe('no data');
    // Não deve ter chaves undefined
    expect(Object.keys(parsed).sort()).toEqual(['level', 'message', 'service', 'timestamp']);
  });

  it('data array NÃO é spread (mantido como primitivo)', () => {
    const log = makeLogger('svc');
    log('info', 'with array', [1, 2, 3]);
    const parsed = JSON.parse(logCalls[0]!);
    // Arrays são objetos no typeof, mas o código verifica !Array.isArray
    // para evitar spread de arrays (que vira '[1,2,3]' como string).
    expect(Array.isArray(parsed)).toBe(false);
  });

  it('data primitivo é descartado', () => {
    const log = makeLogger('svc');
    log('info', 'msg', 42 as unknown);
    const parsed = JSON.parse(logCalls[0]!);
    expect(parsed.message).toBe('msg');
    // Não deve ter chave "42"
    expect(Object.keys(parsed)).not.toContain('42');
  });

  it("level 'error' usa console.error", () => {
    const log = makeLogger('svc');
    log('error', 'something failed');
    expect(errCalls).toHaveLength(1);
    expect(logCalls).toHaveLength(0);
    expect(JSON.parse(errCalls[0]!).level).toBe('error');
  });

  it("level 'warn' usa console.log (não error)", () => {
    const log = makeLogger('svc');
    log('warn', 'be careful');
    expect(logCalls).toHaveLength(1);
    expect(errCalls).toHaveLength(0);
  });

  it("level 'info' usa console.log", () => {
    const log = makeLogger('svc');
    log('info', 'info message');
    expect(logCalls).toHaveLength(1);
    expect(errCalls).toHaveLength(0);
  });

  it('loggers diferentes têm service próprio', () => {
    const logA = makeLogger('service-a');
    const logB = makeLogger('service-b');
    logA('info', 'msg from a');
    logB('info', 'msg from b');

    const parsedA = JSON.parse(logCalls[0]!);
    const parsedB = JSON.parse(logCalls[1]!);
    expect(parsedA.service).toBe('service-a');
    expect(parsedB.service).toBe('service-b');
    expect(parsedA.message).toBe('msg from a');
    expect(parsedB.message).toBe('msg from b');
  });
});
