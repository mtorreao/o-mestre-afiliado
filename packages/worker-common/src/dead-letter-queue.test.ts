/**
 * Testes das funções PURAS da Dead Letter Queue.
 *
 * Cobre (sem Redis):
 *  - buildDlqEntry: montagem de entrada a partir de DLQPushParams
 *  - serializeDlqItem / parseDlqItem: round-trip, item válido,
 *    item malformado (JSON inválido), campos ausentes, metadados opcionais
 *  - dlqItemQueue: detecção de fila de origem (A=Ingestor, B=Dispatcher)
 *  - filterDlqItems: filtros failureReason, queue, since
 */
import { describe, expect, it } from 'bun:test';
import type { MirrorDLQEntry, RawMessageEvent, SendEvent } from '@omestre/shared';
import {
  buildDlqEntry,
  serializeDlqItem,
  parseDlqItem,
  dlqItemQueue,
  filterDlqItems,
} from './dead-letter-queue.ts';

// ─── Fixtures ──────────────────────────────────────────────────────────

function makeRawEvent(): RawMessageEvent {
  return {
    messageId: 'msg-1',
    instanceName: 'user-1',
    sourceGroupJid: 'source@group',
    sourceGroupName: 'Grupo Origem',
    text: 'https://shopee.com.br/produto-i.123.456',
    timestamp: 1700000000,
  };
}

function makeSendEvent(): SendEvent {
  return {
    id: 'send-1',
    sourceMessageId: 'msg-1',
    sourceGroupJid: 'source@group',
    mirrorId: 1,
    text: 'link convertido',
    imageUrl: 'https://img',
    marketplace: 'shopee',
    originalUrl: 'https://shopee.com.br/produto-i.123.456',
    convertedUrl: 'https://shp.ee/abc',
  };
}

const baseParams = {
  event: makeRawEvent(),
  failureReason: 'conversion_failed',
  attempts: 3,
  lastError: 'timeout',
  marketplace: 'shopee',
  originalUrl: 'https://shopee.com.br/produto-i.123.456',
  conversionSuccess: false,
  targetGroupJids: ['dest@group'],
};

// ─── buildDlqEntry ──────────────────────────────────────────────────────

describe('buildDlqEntry', () => {
  it('constrói entrada com id e failedAt gerados', () => {
    const entry = buildDlqEntry(baseParams);
    expect(entry.id).toBeDefined();
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.failedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(entry.reprocessed).toBe(false);
  });

  it('usa id e now injetados (testabilidade determinística)', () => {
    const entry = buildDlqEntry(
      baseParams,
      () => '2024-01-01T00:00:00.000Z',
      () => 'fixed-id',
    );
    expect(entry.id).toBe('fixed-id');
    expect(entry.failedAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('copía metadados do params', () => {
    const entry = buildDlqEntry(baseParams);
    expect(entry.event).toBe(baseParams.event);
    expect(entry.failureReason).toBe('conversion_failed');
    expect(entry.attempts).toBe(3);
    expect(entry.lastError).toBe('timeout');
    expect(entry.marketplace).toBe('shopee');
    expect(entry.originalUrl).toBe('https://shopee.com.br/produto-i.123.456');
    expect(entry.conversionSuccess).toBe(false);
    expect(entry.targetGroupJids).toEqual(['dest@group']);
  });

  it('funciona com SendEvent e campos opcionais ausentes', () => {
    const entry = buildDlqEntry({
      event: makeSendEvent(),
      failureReason: 'x',
      attempts: 1,
      lastError: 'y',
    });
    expect(entry.marketplace).toBeUndefined();
    expect(entry.originalUrl).toBeUndefined();
    expect(entry.conversionSuccess).toBeUndefined();
    expect(entry.targetGroupJids).toBeUndefined();
    // SendEvent → fila B
    expect(dlqItemQueue(entry)).toBe('B');
  });
});

// ─── serializeDlqItem / parseDlqItem round-trip ─────────────────────────

describe('serializeDlqItem / parseDlqItem (round-trip)', () => {
  it('reconstroi entrada idêntica após serialize→parse', () => {
    const entry = buildDlqEntry(
      baseParams,
      () => '2024-01-01T00:00:00.000Z',
      () => 'id-1',
    );
    const restored = parseDlqItem(serializeDlqItem(entry));
    expect(restored).not.toBeNull();
    expect(restored).toEqual(entry);
  });

  it('preserva campos de reprocessamento (reprocessedAt/reprocessResult)', () => {
    const entry: MirrorDLQEntry = {
      ...buildDlqEntry(
        baseParams,
        () => '2024-01-01T00:00:00.000Z',
        () => 'id-1',
      ),
      reprocessed: true,
      reprocessedAt: '2024-02-01T00:00:00.000Z',
      reprocessResult: 're-enfileirado no stream',
    };
    const restored = parseDlqItem(serializeDlqItem(entry));
    expect(restored?.reprocessed).toBe(true);
    expect(restored?.reprocessedAt).toBe('2024-02-01T00:00:00.000Z');
    expect(restored?.reprocessResult).toBe('re-enfileirado no stream');
  });
});

// ─── parseDlqItem — casos de erro / malformado ──────────────────────────

describe('parseDlqItem — item malformado', () => {
  it('retorna null para JSON inválido', () => {
    expect(parseDlqItem('{not valid json')).toBeNull();
  });

  it('retorna null para string vazia', () => {
    expect(parseDlqItem('')).toBeNull();
  });

  it('retorna null quando parsed não é objeto', () => {
    expect(parseDlqItem('123')).toBeNull();
    expect(parseDlqItem('"string"')).toBeNull();
    expect(parseDlqItem('null')).toBeNull();
  });

  it('retorna null quando id ausente', () => {
    const raw = JSON.stringify({ event: makeRawEvent(), failureReason: 'x' });
    expect(parseDlqItem(raw)).toBeNull();
  });

  it('retorna null quando id é string vazia', () => {
    const raw = JSON.stringify({ id: '', event: makeRawEvent() });
    expect(parseDlqItem(raw)).toBeNull();
  });

  it('retorna null quando event ausente', () => {
    const raw = JSON.stringify({ id: 'abc', failureReason: 'x' });
    expect(parseDlqItem(raw)).toBeNull();
  });

  it('retorna null quando event não é objeto', () => {
    const raw = JSON.stringify({ id: 'abc', event: 'not-an-object' });
    expect(parseDlqItem(raw)).toBeNull();
  });
});

// ─── parseDlqItem — campos ausentes / defaults ──────────────────────────

describe('parseDlqItem — campos ausentes recebem defaults', () => {
  it('preenche failureReason/lastError/attempts/failedAt com defaults', () => {
    const raw = JSON.stringify({ id: 'abc', event: makeRawEvent() });
    const parsed = parseDlqItem(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.failureReason).toBe('');
    expect(parsed!.lastError).toBe('');
    expect(parsed!.attempts).toBe(0);
    expect(parsed!.failedAt).toBe('');
    expect(parsed!.reprocessed).toBe(false);
  });

  it('mantém campos opcionais ausentes como undefined', () => {
    const raw = JSON.stringify({ id: 'abc', event: makeRawEvent() });
    const parsed = parseDlqItem(raw);
    expect(parsed!.marketplace).toBeUndefined();
    expect(parsed!.originalUrl).toBeUndefined();
    expect(parsed!.conversionSuccess).toBeUndefined();
    expect(parsed!.targetGroupJids).toBeUndefined();
  });

  it('respeita metadados opcionais quando presentes', () => {
    const raw = JSON.stringify({
      id: 'abc',
      event: makeRawEvent(),
      marketplace: 'amazon',
      originalUrl: 'https://amazon.com.br/dp/X',
      conversionSuccess: true,
      targetGroupJids: ['g1', 'g2'],
      reprocessed: true,
    });
    const parsed = parseDlqItem(raw);
    expect(parsed!.marketplace).toBe('amazon');
    expect(parsed!.originalUrl).toBe('https://amazon.com.br/dp/X');
    expect(parsed!.conversionSuccess).toBe(true);
    expect(parsed!.targetGroupJids).toEqual(['g1', 'g2']);
    expect(parsed!.reprocessed).toBe(true);
  });
});

// ─── dlqItemQueue ────────────────────────────────────────────────────────

describe('dlqItemQueue', () => {
  it('classifica RawMessageEvent como fila A (Ingestor)', () => {
    const entry = buildDlqEntry({ ...baseParams, event: makeRawEvent() });
    expect(dlqItemQueue(entry)).toBe('A');
  });

  it('classifica SendEvent como fila B (Dispatcher)', () => {
    const entry = buildDlqEntry({ ...baseParams, event: makeSendEvent() });
    expect(dlqItemQueue(entry)).toBe('B');
  });
});

// ─── filterDlqItems ─────────────────────────────────────────────────────

function makeEntry(
  id: string,
  failureReason: string,
  queue: 'A' | 'B',
  failedAtIso: string,
): MirrorDLQEntry {
  const event = queue === 'A' ? makeRawEvent() : makeSendEvent();
  return {
    id,
    event,
    failureReason,
    attempts: 1,
    lastError: '',
    failedAt: failedAtIso,
    reprocessed: false,
  };
}

describe('filterDlqItems', () => {
  const items: MirrorDLQEntry[] = [
    makeEntry('1', 'conversion_failed', 'A', '2024-01-02T00:00:00.000Z'),
    makeEntry('2', 'conversion_failed', 'B', '2024-01-05T00:00:00.000Z'),
    makeEntry('3', 'network_error', 'A', '2024-01-10T00:00:00.000Z'),
    makeEntry('4', 'network_error', 'B', '2024-01-20T00:00:00.000Z'),
  ];

  it('retorna todos sem filtros', () => {
    expect(filterDlqItems(items)).toHaveLength(4);
  });

  it('filtra por failureReason (match exato)', () => {
    const result = filterDlqItems(items, { failureReason: 'network_error' });
    expect(result.map((e) => e.id).sort()).toEqual(['3', '4']);
  });

  it('filtra por queue A (RawMessageEvent)', () => {
    const result = filterDlqItems(items, { queue: 'A' });
    expect(result.map((e) => e.id).sort()).toEqual(['1', '3']);
  });

  it('filtra por queue B (SendEvent)', () => {
    const result = filterDlqItems(items, { queue: 'B' });
    expect(result.map((e) => e.id).sort()).toEqual(['2', '4']);
  });

  it('filtra por since (failedAt >= since)', () => {
    const since = Date.parse('2024-01-06T00:00:00.000Z');
    const result = filterDlqItems(items, { since });
    // ids 3 (2024-01-10) e 4 (2024-01-20) passam
    expect(result.map((e) => e.id).sort()).toEqual(['3', '4']);
  });

  it('rejeita item com failedAt inválido no filtro since', () => {
    const bad = makeEntry('bad', 'x', 'A', '');
    const result = filterDlqItems([bad], { since: 0 });
    expect(result).toHaveLength(0);
  });

  it('combina múltiplos filtros (failureReason + queue)', () => {
    const result = filterDlqItems(items, { failureReason: 'network_error', queue: 'B' });
    expect(result.map((e) => e.id)).toEqual(['4']);
  });

  it('não altera o array original', () => {
    const snapshot = [...items];
    filterDlqItems(items, { queue: 'A' });
    expect(items).toEqual(snapshot);
  });

  it('retorna array vazio quando nada casa', () => {
    const result = filterDlqItems(items, { failureReason: 'inexistente' });
    expect(result).toHaveLength(0);
  });
});
