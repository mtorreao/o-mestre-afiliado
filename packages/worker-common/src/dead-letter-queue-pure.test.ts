/**
 * Testes das funções PURAS adicionais da Dead Letter Queue
 * (dead-letter-queue-pure.ts).
 *
 * Cobre a lógica de decisão que antes vivia inline em `listDLQ` /
 * `requeueFromDLQ` (fetch-limit, reprocessamento, paginação) — sem Redis.
 */
import { describe, expect, it } from 'bun:test';
import type { MirrorDLQEntry } from '@omestre/shared';
import {
  buildReprocessedEntry,
  resolveDlqFetchLimit,
  sliceDlqPage,
} from './dead-letter-queue-pure.ts';

function makeEntry(id: string, failedAtIso: string): MirrorDLQEntry {
  return {
    id,
    event: {
      messageId: `msg-${id}`,
      instanceName: 'user-1',
      sourceGroupJid: 's',
      sourceGroupName: 'S',
      text: 't',
      timestamp: 1,
    },
    failureReason: 'x',
    attempts: 1,
    lastError: '',
    failedAt: failedAtIso,
    reprocessed: false,
  };
}

// ─── resolveDlqFetchLimit ──────────────────────────────────────────────

describe('resolveDlqFetchLimit', () => {
  it('sem since → teto alto (100_000)', () => {
    expect(resolveDlqFetchLimit(undefined, 0, 20)).toBe(100_000);
    expect(resolveDlqFetchLimit(undefined, 100, 50)).toBe(100_000);
  });

  it('com since → folga (offset+limit)*10 + 100', () => {
    // (0 + 20) * 10 + 100 = 300
    expect(resolveDlqFetchLimit(123, 0, 20)).toBe(300);
    // (40 + 50) * 10 + 100 = 1000
    expect(resolveDlqFetchLimit(123, 40, 50)).toBe(1000);
  });

  it('mesma entrada produz valor estável', () => {
    expect(resolveDlqFetchLimit(1, 5, 10)).toBe(resolveDlqFetchLimit(999, 5, 10));
  });
});

// ─── buildReprocessedEntry ─────────────────────────────────────────────

describe('buildReprocessedEntry', () => {
  it('marca reprocessed e preenche metadados', () => {
    const item = makeEntry('id-1', '2024-01-01T00:00:00.000Z');
    const updated = buildReprocessedEntry(item, () => '2024-02-02T00:00:00.000Z');
    expect(updated.reprocessed).toBe(true);
    expect(updated.reprocessedAt).toBe('2024-02-02T00:00:00.000Z');
    expect(updated.reprocessResult).toBe('re-enfileirado no stream');
    // demais campos preservados
    expect(updated.id).toBe('id-1');
    expect(updated.failureReason).toBe('x');
  });

  it('não altera o item original (cópia)', () => {
    const item = makeEntry('id-1', '2024-01-01T00:00:00.000Z');
    const snapshot = JSON.stringify(item);
    buildReprocessedEntry(item, () => '2024-02-02T00:00:00.000Z');
    expect(JSON.stringify(item)).toBe(snapshot);
  });
});

// ─── sliceDlqPage ──────────────────────────────────────────────────────

describe('sliceDlqPage', () => {
  const items = [
    makeEntry('1', '2024-01-01T00:00:00.000Z'),
    makeEntry('2', '2024-01-02T00:00:00.000Z'),
    makeEntry('3', '2024-01-03T00:00:00.000Z'),
    makeEntry('4', '2024-01-04T00:00:00.000Z'),
  ];

  it('aplica offset + limit', () => {
    expect(sliceDlqPage(items, 1, 2).map((e) => e.id)).toEqual(['2', '3']);
  });

  it('offset 0 + limit total', () => {
    expect(sliceDlqPage(items, 0, 4)).toHaveLength(4);
  });

  it('limite além do fim → o que sobrou', () => {
    expect(sliceDlqPage(items, 3, 100).map((e) => e.id)).toEqual(['4']);
  });

  it('offset além do fim → vazio', () => {
    expect(sliceDlqPage(items, 10, 5)).toEqual([]);
  });

  it('não altera o array original', () => {
    const snapshot = items.map((e) => e.id);
    sliceDlqPage(items, 1, 2);
    expect(items.map((e) => e.id)).toEqual(snapshot);
  });
});
