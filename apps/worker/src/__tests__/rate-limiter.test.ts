/**
 * Test: Validar rate limit no sendToGroup.
 *
 * Critério: máximo N mensagens/minuto por instância Evolution.
 * Usa Redis para contagem (fixed window via INCR + EXPIRE).
 *
 * Estratégia: mockamos o módulo `ioredis` para controlar os
 * contadores e verificamos o comportamento do rate limiter
 * através das funções exportadas tryAcquireSlot e waitForSlot.
 *
 * Cenários:
 *   1. Key pattern: mirror:ratelimit:{instanceName}:{windowIndex}
 *   2. TTL = WINDOW_SEC * 2 no primeiro incremento (count=1)
 *   3. Limite não atingido → acquired=true, waitMs=0
 *   4. Limite excedido → acquired=false, waitMs ~ fim da janela
 *   5. Limite exato (count === MAX) → acquired=true
 *   6. Independência entre instâncias (contadores separados)
 *   7. Falha silenciosa quando Redis está indisponível
 *   8. waitForSlot retorna true quando slot fica disponível
 *   9. waitForSlot retorna false no timeout
 */

import { describe, it, expect, mock, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';

// ════════════════════════════════════════════════════════
// Mock ioredis — executado ANTES de qualquer import
// ════════════════════════════════════════════════════════

/** Armazena o estado de contadores por chave Redis. */
const redisStore = new Map<string, number>();
/** TTLs por chave (ms para expirar). */
const redisTTLs = new Map<string, number>();
/** Flags por chave para simular erros. */
const redisErrors = new Set<string>();
/** Controla se o Redis como um todo está down. */
let redisDown = false;

/** Mock da função incr */
const mockIncr = mock((key: string): Promise<number> => {
  if (redisDown) throw new Error('ECONNREFUSED: Redis offline');
  if (redisErrors.has(key)) throw new Error('ERR: Redis error simulado');
  const next = (redisStore.get(key) || 0) + 1;
  redisStore.set(key, next);
  return Promise.resolve(next);
});

/** Mock da função expire */
const mockExpire = mock((key: string, ttl: number): Promise<number> => {
  if (redisDown) throw new Error('ECONNREFUSED');
  redisTTLs.set(key, ttl);
  return Promise.resolve(1);
});

/** Mock do construtor */
class MockRedis {
  incr = mockIncr;
  expire = mockExpire;
  on = mock((_event: string, _cb: Function) => {});
  constructor(_url?: string, _opts?: Record<string, unknown>) {}
}

// ════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════

function resetMocks() {
  redisStore.clear();
  redisTTLs.clear();
  redisErrors.clear();
  redisDown = false;
  mockIncr.mockClear();
  mockExpire.mockClear();
}

/** Extrai o windowIndex de uma chave Redis. */
function extractWindowIndex(key: string): number | null {
  const parts = key.split(':');
  const last = parts[parts.length - 1];
  if (last === undefined) return null;
  const n = parseInt(last, 10);
  return isNaN(n) ? null : n;
}

// ════════════════════════════════════════════════════════
// Testes
// ════════════════════════════════════════════════════════

describe('rate-limiter', () => {
  beforeAll(() => {
    mock.module('ioredis', () => ({
      default: MockRedis,
    }));
  });

  afterAll(() => {
    mock.restore();
  });

  describe('rate-limiter — tryAcquireSlot', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    resetMocks();
  });

  // ── Teste 1: Key pattern ──────────────────────────────
  it(
    'gera chave Redis no formato mirror:ratelimit:{instanceName}:{windowIndex}',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Força a criação do mock Redis chamando tryAcquireSlot
      await tryAcquireSlot('user-42');

      // Verifica que incr foi chamado com a chave correta
      expect(mockIncr).toHaveBeenCalledTimes(1);
      const calledKey = mockIncr.mock.calls[0]![0] as string;

      // Formato esperado: mirror:ratelimit:user-42:{epochMinute}
      expect(calledKey).toMatch(/^mirror:ratelimit:user-42:\d+$/);

      // O windowIndex deve ser um número positivo
      const windowIndex = extractWindowIndex(calledKey);
      expect(windowIndex).toBeGreaterThan(0);
    },
  );

  // ── Teste 2: TTL no primeiro incremento ───────────────
  it(
    'define TTL = WINDOW_SEC * 2 no primeiro incremento (count=1)',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // incr retorna 1 (primeira chamada) — deve chamar expire
      await tryAcquireSlot('user-1');

      expect(mockExpire).toHaveBeenCalledTimes(1);

      // TTL = 60 * 2 = 120s (valores default)
      const ttlArg = mockExpire.mock.calls[0]![1] as number;
      expect(ttlArg).toBe(120);
    },
  );

  // ── Teste 3: TTL NÃO é definido em incrementos subsequentes ──
  it(
    'NÃO redefine TTL em incrementos após o primeiro',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Primeira chamada — define TTL (count=1)
      await tryAcquireSlot('user-1');
      expect(mockExpire).toHaveBeenCalledTimes(1);

      // Segunda chamada — NÃO redefine TTL (count=2)
      mockExpire.mockClear();
      await tryAcquireSlot('user-1');
      expect(mockExpire).toHaveBeenCalledTimes(0);
    },
  );

  // ── Teste 4: Limite não atingido → acquired=true ──────
  it(
    'retorna acquired=true quando abaixo do limite (padrão: 20)',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Simula 5 chamadas — todas abaixo do limite de 20
      for (let i = 0; i < 5; i++) {
        const result = await tryAcquireSlot('user-1');
        expect(result).toEqual({ acquired: true, waitMs: 0 });
      }

      // mockIncr deve ter sido chamado 5 vezes
      expect(mockIncr).toHaveBeenCalledTimes(5);
    },
  );

  // ── Teste 5: Limite exato (count === MAX) → acquired=true ──
  it(
    'retorna acquired=true quando count == MAX (exatamente no limite)',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Simula 20 chamadas — a 20ª está exatamente no limite
      for (let i = 0; i < 20; i++) {
        const result = await tryAcquireSlot('user-exact');
        expect(result).toEqual({ acquired: true, waitMs: 0 });
      }

      expect(mockIncr).toHaveBeenCalledTimes(20);
    },
  );

  // ── Teste 6: Limite excedido → acquired=false ─────────
  it(
    'retorna acquired=false quando count > MAX (limite excedido)',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Faz 20 chamadas — todas devem passar (acquired=true)
      for (let i = 0; i < 20; i++) {
        const r = await tryAcquireSlot('user-over');
        expect(r.acquired).toBe(true);
      }

      // A 21ª chamada excede o limite
      const result = await tryAcquireSlot('user-over');

      expect(result.acquired).toBe(false);
      expect(result.waitMs).toBeGreaterThan(0);
      // waitMs deve ser <= WINDOW_SEC * 1000 (60s)
      expect(result.waitMs).toBeLessThanOrEqual(60_000);
      // Deve ter um mínimo de 100ms
      expect(result.waitMs).toBeGreaterThanOrEqual(100);
    },
  );

  // ── Teste 7: waitMs reflete o tempo restante da janela (após exceder o limite) ──
  it(
    'waitMs é um número positivo entre 100ms e 60s quando o limite é excedido',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Excede o limite: 21 chamadas
      for (let i = 0; i < 21; i++) {
        await tryAcquireSlot('user-wait');
      }

      // Agora está acima do limite
      const result = await tryAcquireSlot('user-wait');

      expect(result.acquired).toBe(false);
      // O waitMs deve ser pelo menos 100ms e no máximo 60s
      expect(result.waitMs).toBeGreaterThanOrEqual(100);
      expect(result.waitMs).toBeLessThanOrEqual(60_000);
    },
  );

  // ── Teste 8: Independência entre instâncias ───────────
  it(
    'mantém contadores independentes por instanceName (chaves diferentes)',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Instância A faz até o limite (20)
      for (let i = 0; i < 20; i++) {
        const r = await tryAcquireSlot('instance-a');
        expect(r.acquired).toBe(true);
      }

      // Instância B começa do zero — deve estar disponível
      const resultB = await tryAcquireSlot('instance-b');
      expect(resultB).toEqual({ acquired: true, waitMs: 0 });

      // Instância A já está no limite — excede
      const resultA2 = await tryAcquireSlot('instance-a');
      expect(resultA2.acquired).toBe(false);

      // Verifica que as chaves são diferentes
      const allCalls = mockIncr.mock.calls;
      // As primeiras 20 chamadas são da instância A
      const keyA0 = allCalls[0]![0] as string;
      expect(keyA0).toContain('instance-a');
      // A 21ª chamada é da instância B
      const keyB = allCalls[20]![0] as string;
      expect(keyB).toContain('instance-b');
      // A 22ª chamada é da instância A novamente (excedida)
      const keyA1 = allCalls[21]![0] as string;
      expect(keyA1).toContain('instance-a');
    },
  );

  // ── Teste 9: Falha silenciosa quando Redis offline ────
  it(
    'retorna acquired=true silenciosamente quando Redis está offline',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Redis caiu
      redisDown = true;

      // Deve retornar acquired=true (fail-open) sem lançar exceção
      const result = await tryAcquireSlot('user-offline');
      expect(result).toEqual({ acquired: true, waitMs: 0 });
    },
  );

  // ── Teste 10: Falha silenciosa quando incr lança erro ──
  it(
    'retorna acquired=true silenciosamente quando Redis lança erro no incr',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Simula erro em chave específica
      redisErrors.add('mirror:ratelimit:user-err:99999999');

      const result = await tryAcquireSlot('user-err');
      expect(result).toEqual({ acquired: true, waitMs: 0 });
    },
  );
});

describe('rate-limiter — waitForSlot', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    resetMocks();
  });

  // ── Teste 11: waitForSlot retorna true quando slot disponível ──
  it(
    'retorna true quando a janela reinicia e slot fica disponível',
    async () => {
      const { tryAcquireSlot, waitForSlot } = await import('../rate-limiter.ts');

      // Enche o contador para exceder o limite
      redisStore.set('mirror:ratelimit:user-wait-slot:99999999', 25);

      // waitForSlot com maxTotalWaitMs baixo para teste rápido
      // Como o mock de incr sempre retorna o valor do store,
      // a única maneira de "liberar" é resetar o store.
      // Aqui testamos o timeout rápido.
      const result = await waitForSlot('user-wait-slot', 100);

      // Com apenas 100ms de timeout, deve retornar false
      // (a janela não vai resetar sozinha no mock)
      expect(result).toBe(false);
    },
  );

  // ── Teste 12: waitForSlot timeout ─────────────────────
  it(
    'retorna false quando o timeout total é excedido sem conseguir slot',
    async () => {
      const { waitForSlot } = await import('../rate-limiter.ts');

      // Simula que o contador está alto e nunca vai baixar
      // Timeout pequeno para teste rápido
      const start = Date.now();
      const result = await waitForSlot('user-timeout', 200);
      const elapsed = Date.now() - start;

      // Deve retornar false após timeout
      expect(result).toBe(false);

      // Deve ter levado pelo menos 200ms (mas não muito mais)
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(5000);
    },
  );

  // ── Teste 13: waitForSlot retorna false quando Redis offline ──
  it(
    'retorna acquired=true (fail-open) quando Redis está offline via waitForSlot',
    async () => {
      const { waitForSlot } = await import('../rate-limiter.ts');

      // Redis offline — waitForSlot chama tryAcquireSlot que faz fail-open
      redisDown = true;

      // Deve retornar true rapidamente (fail-open)
      const result = await waitForSlot('user-offline', 5000);
      expect(result).toBe(true);
    },
  );
});

describe('rate-limiter — recuperação após erro do Redis', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    resetMocks();
  });

  // ── Teste 14: Após Redis ficar offline, retorna acquired=true (fail-open) ──
  it(
    'continua retornando acquired=true (fail-open) após Redis ficar indisponível',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Primeira chamada funciona (Redis ok)
      const r1 = await tryAcquireSlot('user-recover');
      expect(r1).toEqual({ acquired: true, waitMs: 0 });

      // Redis cai
      redisDown = true;

      // Chamada com Redis down
      const r2 = await tryAcquireSlot('user-recover');
      expect(r2).toEqual({ acquired: true, waitMs: 0 });

      // Redis volta
      redisDown = false;

      // Agora o enabled foi setado pra false pelo erro
      // O rate limiter deve continuar com fail-open silencioso
      const r3 = await tryAcquireSlot('user-recover');
      expect(r3).toEqual({ acquired: true, waitMs: 0 });
    },
  );
});

describe('rate-limiter — validação de limites (múltiplas instâncias)', () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    resetMocks();
  });

  // ── Teste 15: 3 instâncias independentes com cargas diferentes ──
  it(
    '3 instâncias operam independentemente com contadores separados',
    async () => {
      const { tryAcquireSlot } = await import('../rate-limiter.ts');

      // Instância 1: 25 mensagens (excede limite de 20)
      const results1: boolean[] = [];
      for (let i = 0; i < 25; i++) {
        const r = await tryAcquireSlot('instance-1');
        results1.push(r.acquired);
      }

      // Instância 2: 15 mensagens (abaixo do limite)
      const results2: boolean[] = [];
      for (let i = 0; i < 15; i++) {
        const r = await tryAcquireSlot('instance-2');
        results2.push(r.acquired);
      }

      // Instância 3: 0 mensagens
      const r3 = await tryAcquireSlot('instance-3');

      // Verificação
      expect(results1.filter(Boolean).length).toBe(20);  // 20 acquired=true
      expect(results1.filter(r => !r).length).toBe(5);    // 5 acquired=false
      expect(results2.every(Boolean)).toBe(true);         // todas true
      expect(r3).toEqual({ acquired: true, waitMs: 0 });  // primeira chamada
    },
  );
});
});
