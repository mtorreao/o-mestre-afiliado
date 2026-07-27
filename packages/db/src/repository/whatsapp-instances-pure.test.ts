/**
 * Testes das funções PURAS do repositório de instâncias WhatsApp.
 *
 * Cobrem a normalização de `.returning()` (ensureArray) e o mapeamento
 * para dados públicos (remoção de apiKey) — sem PostgreSQL.
 */
import { describe, expect, it } from 'bun:test';
import { ensureArray, toPublic } from './whatsapp-instances-pure.ts';

describe('ensureArray', () => {
  it('retorna array como está', () => {
    const arr = [{ id: 1 }];
    expect(ensureArray(arr)).toBe(arr);
  });

  it('envolve objeto não-vazio em [obj]', () => {
    const obj = { id: 1, instanceId: 'x' };
    expect(ensureArray(obj)).toEqual([obj]);
  });

  it('objeto vazio {} → []', () => {
    expect(ensureArray({})).toEqual([]);
  });

  it('retorna array vazio como está', () => {
    expect(ensureArray([])).toEqual([]);
  });

  it('preserva múltiplos elementos do array', () => {
    const arr = [{ id: 1 }, { id: 2 }];
    expect(ensureArray(arr)).toHaveLength(2);
  });
});

describe('toPublic', () => {
  const row = {
    id: 1,
    userId: 9,
    instanceId: 'inst-1',
    channelType: 'whatsapp',
    rateLimitMaxMsgs: 15,
    rateLimitWindowSec: 300,
    status: 'connected',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-02-01'),
    apiKey: 'super-secret',
  };

  it('remove apiKey', () => {
    const pub = toPublic(row);
    expect('apiKey' in pub).toBe(false);
  });

  it('preserva campos públicos', () => {
    const pub = toPublic(row);
    expect(pub).toEqual({
      id: 1,
      userId: 9,
      instanceId: 'inst-1',
      channelType: 'whatsapp',
      rateLimitMaxMsgs: 15,
      rateLimitWindowSec: 300,
      status: 'connected',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-02-01'),
    });
  });

  it('status vazio preservado (sem normalização)', () => {
    const pub = toPublic({ ...row, status: '' });
    expect(pub.status).toBe('');
  });

  it('apiKey vazio ainda é removido', () => {
    const pub = toPublic({ ...row, apiKey: '' });
    expect('apiKey' in pub).toBe(false);
  });
});
