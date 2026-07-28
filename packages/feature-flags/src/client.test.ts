import { describe, it, expect, mock, afterEach } from 'bun:test';

// Mock do @omestre/db ANTES de importar client.ts
let mockDbFindByKey: any = mock(() => Promise.resolve(null));
const mockDbFindAll = mock(() => Promise.resolve([]));
const mockDbUpsert = mock(() =>
  Promise.resolve({ key: 'test', enabled: true, updatedBy: null, updatedAt: new Date() }),
);

mock.module('@omestre/db', () => ({
  FeatureFlagRepository: mock(() => ({
    findByKey: mockDbFindByKey,
    findAll: mockDbFindAll,
    upsert: mockDbUpsert,
  })),
}));

import { isFeatureEnabled, countFlagChecks, invalidateFlagCache } from './client';
import type { FlagKey } from './registry';

describe('isFeatureEnabled', () => {
  afterEach(() => {
    mockDbFindByKey.mockReset();
    mockDbFindByKey.mockReturnValue(Promise.resolve(null));
    invalidateFlagCache('maintenance_mode');
  });

  it('usa default quando não há linha no banco', async () => {
    const result = await isFeatureEnabled('maintenance_mode');
    expect(result).toBe(false);
  });

  it('retorna valor do banco quando existe', async () => {
    mockDbFindByKey.mockReturnValue(
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

  it('usa cache após primeira busca', async () => {
    await isFeatureEnabled('maintenance_mode');
    await isFeatureEnabled('maintenance_mode');

    // findByKey deve ter sido chamado apenas na primeira vez (cache)
    expect(mockDbFindByKey).toHaveBeenCalledTimes(1);
  });

  it('retorna false para flag desconhecida', async () => {
    const result = await isFeatureEnabled('unknown' as FlagKey);
    expect(result).toBe(false);
  });

  it('usa fallback default quando banco falha', async () => {
    mockDbFindByKey.mockReturnValue(Promise.reject(new Error('DB error')));

    const result = await isFeatureEnabled('maintenance_mode');
    expect(result).toBe(false);
  });
});

describe('countFlagChecks', () => {
  it('retorna 0 quando Redis não está disponível', async () => {
    const result = await countFlagChecks('maintenance_mode');
    expect(result).toBe(0);
  });
});
