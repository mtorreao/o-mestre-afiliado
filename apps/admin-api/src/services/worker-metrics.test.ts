/**
 * Testes das funções PURAS do agregador de métricas
 * (worker-metrics-pure.ts). Sem fetch e sem Redis.
 *
 * Mirror exato de apps/api/src/services/worker-metrics-pure.test.ts.
 */
import { describe, expect, it } from 'bun:test';
import { MIRROR_RAW_STREAM, MIRROR_SEND_STREAM } from '@omestre/shared';
import {
  buildMetricsAuthHeaders,
  computeEffectiveDlqLimit,
  hasServerSideFilter,
  inferRequeueTargetStream,
  normalizeDlqFilters,
} from './worker-metrics-pure.ts';

describe('buildMetricsAuthHeaders', () => {
  it('inclui x-api-key quando há chave', () => {
    expect(buildMetricsAuthHeaders('secret')).toEqual({ 'x-api-key': 'secret' });
  });

  it('objeto vazio sem chave', () => {
    expect(buildMetricsAuthHeaders('')).toEqual({});
  });
});

describe('normalizeDlqFilters', () => {
  it('assinatura legada (offset, limit)', () => {
    expect(normalizeDlqFilters(5, 50)).toEqual({ offset: 5, limit: 50 });
  });

  it('legacyLimit default = 20', () => {
    expect(normalizeDlqFilters(0)).toEqual({ offset: 0, limit: 20 });
  });

  it('assinatura nova (objeto) passa direto', () => {
    const filters = { offset: 1, queue: 'A' as const };
    expect(normalizeDlqFilters(filters)).toBe(filters);
  });
});

describe('hasServerSideFilter', () => {
  it('true com queue', () => {
    expect(hasServerSideFilter({ queue: 'A' })).toBe(true);
  });

  it('true com failureReason', () => {
    expect(hasServerSideFilter({ failureReason: 'cookie_expired' })).toBe(true);
  });

  it('true com since (mesmo 0)', () => {
    expect(hasServerSideFilter({ since: 0 })).toBe(true);
  });

  it('false só com offset/limit', () => {
    expect(hasServerSideFilter({ offset: 5, limit: 50 })).toBe(false);
  });

  it('false para objeto vazio', () => {
    expect(hasServerSideFilter({})).toBe(false);
  });
});

describe('computeEffectiveDlqLimit', () => {
  it('sem filtro: usa limit informado', () => {
    expect(computeEffectiveDlqLimit({ limit: 50 })).toBe(50);
  });

  it('sem filtro e sem limit: default 20', () => {
    expect(computeEffectiveDlqLimit({})).toBe(20);
  });

  it('com filtro: eleva para 100', () => {
    expect(computeEffectiveDlqLimit({ queue: 'A', limit: 20 })).toBe(100);
  });

  it('com filtro sem limit: 100', () => {
    expect(computeEffectiveDlqLimit({ failureReason: 'x' })).toBe(100);
  });

  it('com filtro e limit > 100: mantém o maior', () => {
    expect(computeEffectiveDlqLimit({ queue: 'B', limit: 200 })).toBe(200);
  });
});

describe('inferRequeueTargetStream', () => {
  it('RawMessageEvent (messageId) → Queue A', () => {
    expect(inferRequeueTargetStream({ messageId: 'm1', groupJid: 'g' })).toBe(MIRROR_RAW_STREAM);
  });

  it('SendEvent (sourceMessageId) → Queue B', () => {
    expect(inferRequeueTargetStream({ sourceMessageId: 'm1', mirrorId: 2 })).toBe(
      MIRROR_SEND_STREAM,
    );
  });

  it('evento sem messageId → Queue B (fallback)', () => {
    expect(inferRequeueTargetStream({})).toBe(MIRROR_SEND_STREAM);
  });
});
