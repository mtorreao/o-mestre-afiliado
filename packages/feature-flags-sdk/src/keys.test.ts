/**
 * Testes das constantes e helpers de chave do SDK.
 */
import { describe, expect, it } from 'bun:test';
import {
  bucketAt,
  buildFlagStatsKey,
  FLAG_INVALIDATE_CHANNEL,
  FLAG_STATS_KEY_PREFIX,
} from './keys.ts';

describe('constants', () => {
  it('FLAG_STATS_KEY_PREFIX prefix correto', () => {
    expect(FLAG_STATS_KEY_PREFIX).toBe('omestre:flag:stats:');
  });
  it('FLAG_INVALIDATE_CHANNEL nome correto', () => {
    expect(FLAG_INVALIDATE_CHANNEL).toBe('omestre:flag:invalidate');
  });
});

describe('bucketAt', () => {
  it('formata UTC fixo de referência (2026-08-04T00:00:00Z)', () => {
    expect(bucketAt(Date.UTC(2026, 7, 4, 0, 0, 0))).toBe('202608040000');
  });
  it('preenche zero à esquerda', () => {
    expect(bucketAt(Date.UTC(2026, 0, 4, 3, 5, 0))).toBe('202601040305');
  });
  it('formato YYYYMMDDHHMM (12 chars)', () => {
    const b = bucketAt(Date.UTC(2026, 0, 1, 0, 0, 0));
    expect(b).toHaveLength(12);
  });
  it('UTC puro — não usa fuso local', () => {
    // 23:30 UTC do dia anterior
    const earlier = bucketAt(Date.UTC(2026, 7, 3, 23, 30, 0));
    expect(earlier).toBe('202608032330');
  });
});

describe('buildFlagStatsKey', () => {
  it('compõe key com prefixo + flag + bucket', () => {
    const date = new Date(Date.UTC(2026, 7, 4, 12, 30, 0));
    expect(buildFlagStatsKey('maintenance_mode', date)).toBe(
      'omestre:flag:stats:maintenance_mode:202608041230',
    );
  });
  it('aceita número Epoch ms', () => {
    const epochMs = Date.UTC(2026, 0, 15, 8, 0, 0);
    expect(buildFlagStatsKey('evolution_send_enabled', epochMs)).toBe(
      'omestre:flag:stats:evolution_send_enabled:202601150800',
    );
  });
  it('preserva prefixo do bucket', () => {
    const k = buildFlagStatsKey('flag-x', new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    expect(k.startsWith(FLAG_STATS_KEY_PREFIX)).toBe(true);
  });
});
