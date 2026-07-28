/**
 * Testes do extension-logs-pure — sem I/O, sem mock.
 */
import { describe, expect, it } from 'bun:test';
import {
  ALLOWED_LOG_LEVELS,
  LogValidationError,
  MAX_BATCH_SIZE,
  RateLimiter,
  validateLogBatch,
  validateLogEntry,
} from './extension-logs-pure.ts';

const VALID_ENTRY = {
  sessionId: 'sess-abc123',
  level: 'info',
  event: 'service-worker.boot',
  extensionVersion: '1.6.0',
};

describe('validateLogEntry', () => {
  it('aceita entry mínima válida', () => {
    const v = validateLogEntry(VALID_ENTRY);
    expect(v.sessionId).toBe('sess-abc123');
    expect(v.level).toBe('info');
    expect(v.event).toBe('service-worker.boot');
    expect(v.data).toBe(null);
    expect(v.userEmail).toBe(null);
  });

  it('aceita entry completa', () => {
    const v = validateLogEntry({
      ...VALID_ENTRY,
      userEmail: 'foo@bar.com',
      chromeVersion: '120.0',
      userAgent: 'Mozilla/5.0',
      data: { foo: 'bar', n: 1, b: true, arr: [1, 2] },
    });
    expect(v.userEmail).toBe('foo@bar.com');
    expect(v.data).toEqual({ foo: 'bar', n: 1, b: true, arr: [1, 2] });
  });

  it('rejeita não-objeto', () => {
    expect(() => validateLogEntry(null)).toThrow(LogValidationError);
    expect(() => validateLogEntry('string')).toThrow();
    expect(() => validateLogEntry([])).toThrow();
    expect(() => validateLogEntry(42)).toThrow();
  });

  it('rejeita sessionId inválido', () => {
    expect(() => validateLogEntry({ ...VALID_ENTRY, sessionId: '' })).toThrow(/sessionId/);
    expect(() => validateLogEntry({ ...VALID_ENTRY, sessionId: 123 })).toThrow();
    expect(() => validateLogEntry({ ...VALID_ENTRY, sessionId: 'a'.repeat(101) })).toThrow();
    expect(() => validateLogEntry({ ...VALID_ENTRY, sessionId: 'has space' })).toThrow();
    expect(() => validateLogEntry({ ...VALID_ENTRY, sessionId: 'has.dot' })).toThrow();
  });

  it('rejeita level inválido', () => {
    expect(() => validateLogEntry({ ...VALID_ENTRY, level: 'fatal' })).toThrow(/level/);
    expect(() => validateLogEntry({ ...VALID_ENTRY, level: 1 })).toThrow();
    for (const l of ALLOWED_LOG_LEVELS) {
      expect(() => validateLogEntry({ ...VALID_ENTRY, level: l })).not.toThrow();
    }
  });

  it('rejeita event vazio ou muito longo', () => {
    expect(() => validateLogEntry({ ...VALID_ENTRY, event: '' })).toThrow(/event/);
    expect(() => validateLogEntry({ ...VALID_ENTRY, event: 'x'.repeat(201) })).toThrow();
  });

  it('rejeita data com tipo errado', () => {
    expect(() => validateLogEntry({ ...VALID_ENTRY, data: 'string' })).toThrow(/data/);
    expect(() => validateLogEntry({ ...VALID_ENTRY, data: [1, 2] })).toThrow();
  });

  it('rejeita data com string muito longa', () => {
    expect(() => validateLogEntry({ ...VALID_ENTRY, data: { x: 'a'.repeat(1_001) } })).toThrow(
      /valor/,
    );
  });

  it('rejeita data com muitas chaves', () => {
    const data: Record<string, number> = {};
    for (let i = 0; i < 51; i++) data[`k${i}`] = i;
    expect(() => validateLogEntry({ ...VALID_ENTRY, data })).toThrow(/chaves/);
  });

  it('trunca userEmail/chromeVersion/userAgent em vez de rejeitar', () => {
    const v = validateLogEntry({
      ...VALID_ENTRY,
      userEmail: 'a'.repeat(400),
      chromeVersion: 'b'.repeat(100),
      userAgent: 'c'.repeat(600),
    });
    expect(v.userEmail?.length).toBe(320);
    expect(v.chromeVersion?.length).toBe(50);
    expect(v.userAgent?.length).toBe(500);
  });
});

describe('validateLogBatch', () => {
  it('aceita array de entries válidas', () => {
    const v = validateLogBatch([VALID_ENTRY, { ...VALID_ENTRY, level: 'warn' }]);
    expect(v.length).toBe(2);
  });

  it('rejeita não-array', () => {
    expect(() => validateLogBatch(VALID_ENTRY)).toThrow(/array/);
    expect(() => validateLogBatch({})).toThrow();
  });

  it('rejeita batch vazio', () => {
    expect(() => validateLogBatch([])).toThrow(/vazio/);
  });

  it(`rejeita batch > ${MAX_BATCH_SIZE}`, () => {
    const big = Array.from({ length: MAX_BATCH_SIZE + 1 }, () => VALID_ENTRY);
    expect(() => validateLogBatch(big)).toThrow(/101|máximo/);
  });

  it('propaga erro de entry inválida dentro do batch', () => {
    expect(() => validateLogBatch([VALID_ENTRY, { ...VALID_ENTRY, level: 'fatal' }])).toThrow(
      /level/,
    );
  });

  it('lança LogValidationError (não Error genérico)', () => {
    try {
      validateLogBatch([]);
    } catch (e) {
      expect(e).toBeInstanceOf(LogValidationError);
      expect((e as LogValidationError).code).toBe('batch-empty');
    }
  });
});

describe('RateLimiter', () => {
  it('permite até maxRequests dentro da janela', () => {
    const rl = new RateLimiter(3, 1000);
    expect(rl.check('a', 1000)).toBe(true);
    expect(rl.check('a', 1100)).toBe(true);
    expect(rl.check('a', 1200)).toBe(true);
    expect(rl.check('a', 1300)).toBe(false);
  });

  it('permite novamente após janela passar', () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.check('a', 1000)).toBe(true);
    expect(rl.check('a', 1100)).toBe(true);
    expect(rl.check('a', 1200)).toBe(false);
    // Passou a janela
    expect(rl.check('a', 2100)).toBe(true);
  });

  it('separa contadores por sessionId', () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.check('a', 1000)).toBe(true);
    expect(rl.check('a', 1100)).toBe(true);
    expect(rl.check('a', 1200)).toBe(false);
    // sessionId diferente não foi bloqueado
    expect(rl.check('b', 1200)).toBe(true);
    expect(rl.check('b', 1300)).toBe(true);
    expect(rl.check('b', 1400)).toBe(false);
  });

  it('prune remove entradas expiradas', () => {
    const rl = new RateLimiter(2, 1000);
    rl.check('a', 1000);
    rl.check('b', 1000);
    rl.prune(5000); // tudo expirou
    expect(rl.hits.size).toBe(0);
  });

  it('prune mantém entradas ainda na janela', () => {
    const rl = new RateLimiter(2, 1000);
    rl.check('a', 1000);
    rl.check('a', 1100);
    rl.prune(1500); // 'a' ainda na janela
    expect(rl.hits.size).toBe(1);
  });
});
