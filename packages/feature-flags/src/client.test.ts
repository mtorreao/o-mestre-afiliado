/**
 * Testes do client de feature flags.
 *
 * Estrategia:
 *  - Mock deterministico de @omestre/db (FeatureFlagRepository).
 *  - Mock de ./redis.ts (getFlagRedis/isFlagRedisConnected) controlado por
 *    uma variavel mutavel currentRedis que cada teste ajusta antes de
 *    chamar isFeatureEnabled / countFlagChecks / etc.
 *  - NAO conecta Redis/Postgres reais. Sem timers pendurados.
 */
import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test';

import { installDbMock, getMockDb } from './test-helpers/mock-db.ts';
import { createFakeRedis, resetFakeRedis } from './test-helpers/fake-redis.ts';

// Setup do mock de DB (uma vez por processo)
installDbMock();

// Variavel controlada pelos testes: o que getFlagRedis deve retornar.
let currentRedis: ReturnType<typeof createFakeRedis> | null = null;

// Variavel controlada pelos testes: o que isFlagRedisConnected deve retornar.
let currentConnected: boolean = false;

// Instalacao do mock de ./redis.ts (uma vez por processo)
mock.module('./redis.ts', () => ({
  getFlagRedis: () => currentRedis?.redis ?? null,
  isFlagRedisConnected: () => currentConnected,
}));

// Importacoes DINAMICAS depois dos mocks.
const clientModule = await import('./client.ts');
import type { FlagKey } from './registry.ts';

const {
  isFeatureEnabled,
  countFlagChecks,
  invalidateFlagCache,
  initFlagInvalidation,
  publishFlagInvalidation,
  waitForFlagChange,
} = clientModule;
const { __resetModuleStateForTesting } = clientModule;

// Setup / teardown
beforeEach(() => {
  currentRedis = null;
  currentConnected = false;
  getMockDb().reset();
  __resetModuleStateForTesting();
});

afterEach(() => {
  invalidateFlagCache('maintenance_mode');
  invalidateFlagCache('evolution_send_enabled');
  if (currentRedis) resetFakeRedis(currentRedis);
});

// ─── isFeatureEnabled ─────────────────────────────────────────────────────
describe('isFeatureEnabled', () => {
  it('retorna false para flag desconhecida sem consultar banco nem redis', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;
    currentConnected = true;

    const result = await isFeatureEnabled('unknown' as FlagKey);

    expect(result).toBe(false);
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(0);
  });

  it('usa default quando nao ha linha no banco e cache frio', async () => {
    const result = await isFeatureEnabled('maintenance_mode');
    expect(result).toBe(false);
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);
    expect(getMockDb().findByKey).toHaveBeenCalledWith('maintenance_mode');
  });

  it('retorna valor do banco quando existe (true)', async () => {
    getMockDb().findByKey.mockReturnValueOnce(
      Promise.resolve({
        key: 'evolution_send_enabled',
        enabled: true,
        updatedBy: 'admin',
        updatedAt: new Date(),
      }),
    );
    const result = await isFeatureEnabled('evolution_send_enabled');
    expect(result).toBe(true);
  });

  it('retorna valor do banco quando existe (false)', async () => {
    getMockDb().findByKey.mockReturnValueOnce(
      Promise.resolve({
        key: 'evolution_send_enabled',
        enabled: false,
        updatedBy: 'admin',
        updatedAt: new Date(),
      }),
    );
    const result = await isFeatureEnabled('evolution_send_enabled');
    expect(result).toBe(false);
  });

  it('cache hit na 2a chamada (nao consulta banco novamente)', async () => {
    await isFeatureEnabled('maintenance_mode');
    await isFeatureEnabled('maintenance_mode');
    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);
  });

  it('cache hit usa o valor cacheado mesmo se banco mudou entre chamadas', async () => {
    getMockDb().findByKey.mockReturnValueOnce(
      Promise.resolve({
        key: 'evolution_send_enabled',
        enabled: true,
        updatedBy: 'admin',
        updatedAt: new Date(),
      }),
    );
    const first = await isFeatureEnabled('evolution_send_enabled');
    expect(first).toBe(true);

    getMockDb().findByKey.mockReturnValueOnce(
      Promise.resolve({
        key: 'evolution_send_enabled',
        enabled: false,
        updatedBy: 'admin',
        updatedAt: new Date(),
      }),
    );
    const second = await isFeatureEnabled('evolution_send_enabled');
    expect(second).toBe(true);
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);
  });

  it('fallback para defaultEnabled quando banco falha', async () => {
    getMockDb().findByKey.mockReturnValueOnce(Promise.reject(new Error('DB down')));

    // evolution_send_enabled tem defaultEnabled=true
    const result = await isFeatureEnabled('evolution_send_enabled');
    expect(result).toBe(true);
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);
  });

  it('fallback usa defaultEnabled=false quando flag eh maintenance_mode', async () => {
    getMockDb().findByKey.mockReturnValueOnce(Promise.reject(new Error('DB down')));

    const result = await isFeatureEnabled('maintenance_mode');
    expect(result).toBe(false);
  });

  it('cacheia o fallback apos erro de banco', async () => {
    getMockDb().findByKey.mockReturnValue(Promise.reject(new Error('DB down')));

    await isFeatureEnabled('evolution_send_enabled');
    await isFeatureEnabled('evolution_send_enabled');
    await isFeatureEnabled('evolution_send_enabled');

    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);
  });

  it('incrementa metrica no Redis quando disponivel (cache hit)', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    getMockDb().findByKey.mockReturnValueOnce(
      Promise.resolve({
        key: 'evolution_send_enabled',
        enabled: true,
        updatedBy: 'admin',
        updatedAt: new Date(),
      }),
    );

    await isFeatureEnabled('evolution_send_enabled');
    await isFeatureEnabled('evolution_send_enabled');

    expect(fake.state.incrCalls.length).toBeGreaterThanOrEqual(2);
    expect(fake.state.expireCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of fake.state.incrCalls) {
      expect(c.key).toMatch(/^omestre:flag:stats:evolution_send_enabled:\d{12}$/);
    }
    for (const c of fake.state.expireCalls) {
      expect(c.seconds).toBe(7200);
    }
  });

  it('incrementa metrica mesmo com cache cold (banco resolveu)', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    await isFeatureEnabled('maintenance_mode');

    expect(fake.state.incrCalls.length).toBe(1);
    expect(fake.state.expireCalls.length).toBe(1);
  });

  it('incrementa metrica mesmo em fallback de erro', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;
    getMockDb().findByKey.mockReturnValueOnce(Promise.reject(new Error('boom')));

    await isFeatureEnabled('evolution_send_enabled');

    expect(fake.state.incrCalls.length).toBe(1);
  });

  it('falha do Redis em recordFlagCheck eh silenciosa (best-effort)', async () => {
    const fake = createFakeRedis();
    fake.makeIncrThrowWith('redis incr boom');
    currentRedis = fake;

    const result = await isFeatureEnabled('maintenance_mode');
    expect(result).toBe(false);
  });
});

// ─── countFlagChecks ──────────────────────────────────────────────────────
describe('countFlagChecks', () => {
  it('retorna 0 quando Redis nao esta disponivel', async () => {
    currentRedis = null;
    const result = await countFlagChecks('maintenance_mode');
    expect(result).toBe(0);
  });

  it('soma buckets quando Redis retorna valores', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;
    fake.setMgetResult(0, '5');
    fake.setMgetResult(1, '3');
    fake.setMgetResult(2, null);

    const result = await countFlagChecks('maintenance_mode');

    expect(fake.state.mgetCalls.keys.length).toBe(60);
    // 5 + 3 + 0 + 57*1 = 65
    expect(result).toBe(65);
  });

  it('trata valores nao-numericos como 0', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;
    fake.setMgetResult(0, 'abc');
    fake.setMgetResult(1, '0');

    const result = await countFlagChecks('evolution_send_enabled');

    // 0 + 0 + 58*1 = 58
    expect(result).toBe(58);
  });

  it('retorna 0 quando mget lanca erro', async () => {
    const fake = createFakeRedis();
    fake.makeMgetThrowWith('mget boom');
    currentRedis = fake;

    const result = await countFlagChecks('maintenance_mode');
    expect(result).toBe(0);
  });

  it('consulta exatamente 60 buckets (ultimos 60 minutos)', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    await countFlagChecks('maintenance_mode');

    expect(fake.state.mgetCalls.keys.length).toBe(60);
    for (const k of fake.state.mgetCalls.keys) {
      expect(k).toMatch(/^omestre:flag:stats:maintenance_mode:\d{12}$/);
    }
  });

  it('retorna 0 quando todos os buckets sao null', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;
    for (let i = 0; i < 60; i++) fake.setMgetResult(i, null);

    const result = await countFlagChecks('maintenance_mode');
    expect(result).toBe(0);
  });
});

// ─── invalidateFlagCache ──────────────────────────────────────────────────
describe('invalidateFlagCache', () => {
  it('forca nova consulta ao banco apos invalidacao', async () => {
    await isFeatureEnabled('maintenance_mode');
    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);

    invalidateFlagCache('maintenance_mode');
    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(2);
  });

  it('nao afeta outras flags', async () => {
    await isFeatureEnabled('maintenance_mode');
    await isFeatureEnabled('evolution_send_enabled');

    invalidateFlagCache('maintenance_mode');

    await isFeatureEnabled('maintenance_mode');
    await isFeatureEnabled('evolution_send_enabled');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(3);
  });

  it('eh no-op para chave nao cacheada', () => {
    expect(() => invalidateFlagCache('never_cached')).not.toThrow();
  });
});

// ─── initFlagInvalidation ─────────────────────────────────────────────────
describe('initFlagInvalidation', () => {
  it('eh no-op quando Redis nao esta disponivel', () => {
    currentRedis = null;
    expect(() => initFlagInvalidation()).not.toThrow();
  });

  it('subscreve no canal omestre:flag:invalidate quando Redis disponivel', () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    initFlagInvalidation();

    expect(fake.state.subscribeCalls.length).toBe(1);
    expect(fake.state.subscribeCalls[0]?.channel).toBe('omestre:flag:invalidate');
    expect(fake.state.subscribeCalls[0]?.withCallback).toBe(true);
  });

  it('idempotente: 2a chamada nao duplica subscriber', () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    initFlagInvalidation();
    initFlagInvalidation();
    initFlagInvalidation();

    expect(fake.state.subscribeCalls.length).toBe(1);
  });

  it('log de erro quando subscribe falha', () => {
    const fake = createFakeRedis();
    fake.makeSubscribeFailWith('subscribe boom');
    currentRedis = fake;

    const origError = console.error;
    const calls: unknown[] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      initFlagInvalidation();
    } finally {
      console.error = origError;
    }

    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0] as unknown[];
    const payload = JSON.parse(firstCall[0] as string) as {
      level: string;
      message: string;
      data?: unknown;
    };
    expect(payload.level).toBe('error');
    expect(payload.message).toBe('Erro ao subscrever canal de invalidação');
    expect((payload.data as { error?: string }).error).toContain('subscribe boom');
  });

  it('mensagem recebida invalida cache da flag correspondente', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);

    initFlagInvalidation();
    fake.emitMessage('omestre:flag:invalidate', 'maintenance_mode');

    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(2);
  });

  it('mensagem com whitespace eh trimada antes de invalidar', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);

    initFlagInvalidation();
    fake.emitMessage('omestre:flag:invalidate', '  maintenance_mode  \n');

    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(2);
  });

  it('log info quando subscribe OK', () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    const origLog = console.log;
    const calls: unknown[] = [];
    console.log = (...args: unknown[]) => {
      calls.push(args);
    };
    try {
      initFlagInvalidation();
    } finally {
      console.log = origLog;
    }

    expect(calls.length).toBeGreaterThan(0);
    const firstCall = calls[0] as unknown[];
    const payload = JSON.parse(firstCall[0] as string) as { level: string; message: string };
    expect(payload.level).toBe('info');
    expect(payload.message).toBe('Inscrito no canal omestre:flag:invalidate');
  });
});

// ─── publishFlagInvalidation ──────────────────────────────────────────────
describe('publishFlagInvalidation', () => {
  it('eh no-op quando Redis nao esta disponivel', () => {
    currentRedis = null;
    expect(() => publishFlagInvalidation('maintenance_mode')).not.toThrow();
  });

  it('publica no canal com a chave da flag', () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    publishFlagInvalidation('evolution_send_enabled');

    expect(fake.state.publishCalls.length).toBe(1);
    expect(fake.state.publishCalls[0]?.channel).toBe('omestre:flag:invalidate');
    expect(fake.state.publishCalls[0]?.message).toBe('evolution_send_enabled');
  });

  it('falha do publish eh silenciosa (best-effort)', () => {
    const fake = createFakeRedis();
    fake.makePublishThrowWith('publish boom');
    currentRedis = fake;

    expect(() => publishFlagInvalidation('maintenance_mode')).not.toThrow();
  });
});

// ─── waitForFlagChange ────────────────────────────────────────────────────
describe('waitForFlagChange', () => {
  it('resolve imediato quando Redis nao esta disponivel', async () => {
    currentRedis = null;

    const t0 = Date.now();
    await waitForFlagChange('maintenance_mode', 60_000);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(50);
  });

  it('resolve apos receber mensagem com a chave correta', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    const promise = waitForFlagChange('maintenance_mode', 60_000);

    queueMicrotask(() => {
      fake.emitMessage('omestre:flag:invalidate', 'maintenance_mode');
    });

    await promise;

    expect(fake.state.subscribeCalls.length).toBe(1);
    expect(fake.state.unsubscribeCalls).toBe(1);
  });

  it('resolve apos receber mensagem com whitespace trimmed', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    const promise = waitForFlagChange('maintenance_mode', 60_000);
    queueMicrotask(() => {
      fake.emitMessage('omestre:flag:invalidate', '  maintenance_mode  ');
    });

    await promise;
    expect(fake.state.unsubscribeCalls).toBe(1);
  });

  it('ignora mensagens com chave diferente', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    let resolved = false;
    const promise = waitForFlagChange('maintenance_mode', 80).then(() => {
      resolved = true;
    });

    fake.emitMessage('omestre:flag:invalidate', 'evolution_send_enabled');

    await promise;
    expect(resolved).toBe(true);
    expect(fake.state.unsubscribeCalls).toBe(0);
  });

  it('resolve por timeout quando nenhuma mensagem chega', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    const t0 = Date.now();
    await waitForFlagChange('maintenance_mode', 80);
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(500);
  });

  it('usa timeout default 5_000 quando nao informado', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    const promise = waitForFlagChange('maintenance_mode');
    expect(promise).toBeInstanceOf(Promise);

    queueMicrotask(() => {
      fake.emitMessage('omestre:flag:invalidate', 'maintenance_mode');
    });

    await promise;
    expect(fake.state.unsubscribeCalls).toBe(1);
  });

  it('invalida cache da flag quando mensagem bate', async () => {
    const fake = createFakeRedis();
    currentRedis = fake;

    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(1);

    const promise = waitForFlagChange('maintenance_mode', 60_000);
    queueMicrotask(() => {
      fake.emitMessage('omestre:flag:invalidate', 'maintenance_mode');
    });
    await promise;

    await isFeatureEnabled('maintenance_mode');
    expect(getMockDb().findByKey).toHaveBeenCalledTimes(2);
  });
});
