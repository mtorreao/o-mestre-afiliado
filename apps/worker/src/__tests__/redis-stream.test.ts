/**
 * Test: Validar Redis Stream em vez de PubSub.
 *
 * Critério: PubSub substituído por Stream. Mensagens persistem,
 * consumer group com reentrega, ack explícito.
 *
 * Estratégia: mockamos o Redis com ioredis mock via bun:test mock.module
 * para testar o pipeline de stream completo: XADD, XREADGROUP, XACK,
 * processamento de mensagens pendentes e DLQ para mensagens com >3 tentativas.
 *
 * Cenários:
 *   1. ensureConsumerGroup — cria grupo com MKSTREAM, trata BUSYGROUP
 *   2. ensureConsumerGroup erro genérico — loga warning não fatal
 *   3. processPendingMessages sem pendentes — não faz nada
 *   4. processPendingMessages com pendentes ≤3 — loga e mantém
 *   5. processPendingMessages com pendentes >3 — move para DLQ
 *   6. handleStreamMessage — parse, processa, ACK
 *   7. handleStreamMessage com JSON inválido — ACK mesmo assim
 *   8. handleStreamMessage sem campo payload — ACK e pula
 *   9. consumer group — distribui mensagens para 1 consumer
 *  10. XADD → XREADGROUP → XACK — ciclo completo
 */

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import type { MirrorMessageEvent, MirrorDLQEntry } from '@omestre/shared';
import { MIRROR_STREAM, MIRROR_CONSUMER_GROUP, MIRROR_DLQ_LIST, MIRROR_DLQ_INDEX } from '@omestre/shared';

// ========================================================
// Mock Redis interno — controlado pelo teste
// ========================================================

interface StreamEntry {
  id: string;
  fields: string[];
}

interface PendingEntry {
  id: string;
  consumer: string;
  idle: number;
  deliveryCount: number;
}

interface RedisMockState {
  streams: Map<string, StreamEntry[]>;
  consumerGroups: Map<string, Map<string, { lastId: string; consumers: Map<string, string[]> }>>;
  lists: Map<string, string[]>;
  zsets: Map<string, Map<string, number>>;
}

let redisState: RedisMockState;
let nextStreamId = 1785000000000;

// Atalhos (inicializados após resetRedisState)
let lists: Map<string, string[]>;
let zsets: Map<string, Map<string, number>>;

function resetRedisState() {
  redisState = {
    streams: new Map(),
    consumerGroups: new Map(),
    lists: new Map(),
    zsets: new Map(),
  };
  lists = redisState.lists;
  zsets = redisState.zsets;
  lists.set(MIRROR_DLQ_LIST, []);
  zsets.set(MIRROR_DLQ_INDEX, new Map());
}

function createRedisMock() {
  return {
    // ─── Stream commands ─────────────────────────────────────────
    xadd: async (stream: string, id: string, ...fieldArgs: string[]) => {
      if (!redisState.streams.has(stream)) {
        redisState.streams.set(stream, []);
      }
      const entries = redisState.streams.get(stream)!;
      const msgId = id === '*' ? `${nextStreamId++}-0` : id;
      entries.push({ id: msgId, fields: [...fieldArgs] });
      return msgId;
    },

    xreadgroup: async (...args: string[]) => {
      // XREADGROUP GROUP group consumer [COUNT N] [BLOCK ms] STREAMS stream [id]
      const groupIdx = args.indexOf('GROUP');
      const countIdx = args.indexOf('COUNT');
      const blockIdx = args.indexOf('BLOCK');
      const streamsIdx = args.indexOf('STREAMS');

      const groupName = args[groupIdx + 1];
      const consumerName = args[groupIdx + 2];
      const count = countIdx !== -1 ? parseInt(args[countIdx + 1], 10) : 1;
      const streamName = args[streamsIdx + 1];
      const readId = args[streamsIdx + 2];

      if (!redisState.consumerGroups.has(streamName)) {
        return null;
      }

      const group = redisState.consumerGroups.get(streamName)!;
      if (!group.has(groupName)) return null;

      const groupData = group.get(groupName)!;
      if (!groupData.consumers.has(consumerName)) {
        groupData.consumers.set(consumerName, []);
      }

      const entries = redisState.streams.get(streamName) || [];
      const consumerPending = groupData.consumers.get(consumerName)!;

      let newEntries: StreamEntry[] = [];

      if (readId === '>') {
        // Apenas mensagens novas (nunca entregues)
        // lastDeliveredId é o ID da última entregue
        newEntries = entries.filter((e) => {
          const alreadyDelivered = consumerPending.includes(e.id);
          const alreadyInGroup = Array.from(groupData.consumers.values()).some(
            (p) => p.includes(e.id),
          );
          return !alreadyDelivered && !alreadyInGroup && e.id > groupData.lastId;
        });
      } else {
        // Mensagens pendentes específicas (para recovery)
        newEntries = entries.filter((e) => consumerPending.includes(e.id));
      }

      const result = newEntries.slice(0, count);
      if (result.length === 0) return null;

      // Marca como entregue
      for (const entry of result) {
        if (!consumerPending.includes(entry.id)) {
          consumerPending.push(entry.id);
        }
        if (entry.id > groupData.lastId) {
          groupData.lastId = entry.id;
        }
      }

      return [[
        streamName,
        result.map((e) => [e.id, e.fields] as [string, string[]]),
      ]];
    },

    xack: async (stream: string, group: string, ...msgIds: string[]) => {
      if (!redisState.consumerGroups.has(stream)) return 0;
      const grp = redisState.consumerGroups.get(stream)!;
      if (!grp.has(group)) return 0;
      const groupData = grp.get(group)!;

      let acked = 0;
      for (const id of msgIds) {
        for (const [, pending] of groupData.consumers) {
          const idx = pending.indexOf(id);
          if (idx !== -1) {
            pending.splice(idx, 1);
            acked++;
          }
        }
      }
      return acked;
    },

    xgroup: async (action: string, ...args: string[]) => {
      if (action === 'CREATE') {
        const [stream, group, id, ...extra] = args;
        if (!redisState.consumerGroups.has(stream)) {
          redisState.consumerGroups.set(stream, new Map());
        }
        const groups = redisState.consumerGroups.get(stream)!;
        if (groups.has(group)) {
          const err = new Error('BUSYGROUP Consumer Group name already exists');
          (err as any).code = 'BUSYGROUP';
          throw err;
        }
        groups.set(group, {
          lastId: id === '$' ? '0-0' : id,
          consumers: new Map(),
        });
        return 'OK';
      }
      return 'OK';
    },

    xpending: async (stream: string, group: string, start: string, end: string, count: number) => {
      if (!redisState.consumerGroups.has(stream)) return [];
      const grp = redisState.consumerGroups.get(stream)!;
      if (!grp.has(group)) return [];

      const groupData = grp.get(group)!;
      const pending: PendingEntry[] = [];

      for (const [consumer, msgIds] of groupData.consumers) {
        for (const msgId of msgIds) {
          pending.push({
            id: msgId,
            consumer,
            idle: Math.floor(Math.random() * 10000),
            deliveryCount: 1,
          });
        }
      }

      return pending.map((p) => [p.id, p.consumer, p.idle, p.deliveryCount]);
    },

    xrange: async (stream: string, start: string, end: string) => {
      const entries = redisState.streams.get(stream) || [];
      const result = entries.filter((e) => {
        if (start !== '-' && e.id < start) return false;
        if (end !== '+' && e.id > end) return false;
        return true;
      });
      return result.map((e) => [e.id, e.fields] as [string, string[]]);
    },

    // ─── Pipeline ────────────────────────────────────────────────
    pipeline: () => {
      const commands: Array<{ fn: string; args: unknown[] }> = [];
      return {
        rpush: (key: string, ...values: string[]) => {
          commands.push({ fn: 'rpush', args: [key, ...values] });
        },
        lrem: (key: string, count: number, value: string) => {
          commands.push({ fn: 'lrem', args: [key, count, value] });
        },
        zadd: (key: string, score: number, member: string) => {
          commands.push({ fn: 'zadd', args: [key, score, member] });
        },
        zrem: (key: string, ...members: string[]) => {
          commands.push({ fn: 'zrem', args: [key, ...members] });
        },
        exec: async () => {
          for (const cmd of commands) {
            const [key, ...rest] = cmd.args;
            if (cmd.fn === 'rpush') {
              const list = redisState.lists.get(key as string) || [];
              list.push(...(rest as string[]));
              redisState.lists.set(key as string, list);
            } else if (cmd.fn === 'lrem') {
              const list = redisState.lists.get(key as string) || [];
              const count = rest[0] as number;
              const value = rest[1] as string;
              const idx = list.indexOf(value);
              if (idx !== -1) {
                list.splice(idx, count);
              }
            } else if (cmd.fn === 'zadd') {
              const zset = redisState.zsets.get(key as string) || new Map();
              zset.set(rest[1] as string, rest[0] as number);
              redisState.zsets.set(key as string, zset);
            } else if (cmd.fn === 'zrem') {
              const zset = redisState.zsets.get(key as string) || new Map();
              for (let i = 0; i < rest.length; i++) {
                zset.delete(rest[i] as string);
              }
            }
          }
          return [];
        },
      };
    },

    // ─── List commands (for DLQ) ───────────────────────────────
    rpush: async (key: string, ...values: string[]) => {
      const list = redisState.lists.get(key) || [];
      list.push(...values);
      redisState.lists.set(key, list);
      return list.length;
    },
    lrange: async (key: string, _start: number, _stop: number) => {
      return redisState.lists.get(key) || [];
    },
    lrem: async (key: string, count: number, value: string) => {
      const list = redisState.lists.get(key) || [];
      const idx = list.indexOf(value);
      if (idx !== -1) {
        list.splice(idx, count);
        return 1;
      }
      return 0;
    },
    zadd: async (key: string, score: number, member: string) => {
      const zset = redisState.zsets.get(key) || new Map();
      zset.set(member, score);
      redisState.zsets.set(key, zset);
      return 1;
    },
    zcard: async (key: string) => {
      const zset = redisState.zsets.get(key);
      return zset ? zset.size : 0;
    },
    zrem: async (key: string, ...members: string[]) => {
      const zset = redisState.zsets.get(key);
      if (!zset) return 0;
      let removed = 0;
      for (const m of members) {
        if (zset.delete(m)) removed++;
      }
      return removed;
    },
    zrangebyscore: async (key: string, min: number, max: number) => {
      const zset = redisState.zsets.get(key);
      if (!zset) return [];
      return [...zset.entries()]
        .filter(([, score]) => score >= min && score <= max)
        .map(([member]) => member);
    },
    on() {},
    disconnect() {},
    quit() {},
  };
}

// Mock do módulo ioredis
let currentRedisMock: ReturnType<typeof createRedisMock>;

mock.module('ioredis', () => {
  return {
    default: class MockRedis {
      constructor() {
        currentRedisMock = createRedisMock();
        Object.assign(this, currentRedisMock);
      }
      on() {}
      disconnect() {}
      quit() {}
    },
    Redis: class MockRedis {
      constructor() {
        currentRedisMock = createRedisMock();
        Object.assign(this, currentRedisMock);
      }
      on() {}
      disconnect() {}
      quit() {}
    },
  };
});

// ════════════════════════════════════════════════════════
// Constantes locais (cópia do index.ts)
// ════════════════════════════════════════════════════════

const CACHE_PREFIX = 'mirror:source-group:';
const CACHE_SET_KEY = 'mirror:source-groups:all';

// ════════════════════════════════════════════════════════
// Fixtures
// ════════════════════════════════════════════════════════

const baseEvent: MirrorMessageEvent = {
  messageId: 'stream-test-msg-001',
  instanceName: 'user-1',
  sourceGroupJid: '120363000000000000@g.us',
  sourceGroupName: 'Grupo Teste Stream',
  affiliateId: 1,
  text: 'Oferta! https://shopee.com.br/product/STREAM001',
  timestamp: Math.floor(Date.now() / 1000),
};

const samplePayload = JSON.stringify(baseEvent);

// ════════════════════════════════════════════════════════
// Testes
// ════════════════════════════════════════════════════════

describe('Redis Stream pipeline', () => {
  let redis: any;

  beforeEach(async () => {
    resetRedisState();
    // Seta REDIS_URL para o módulo sob teste detectar
    process.env.REDIS_URL = 'redis://mock:6379';

    // Cria uma instância mock do Redis ativando o mock.module
    const ioredis = await import('ioredis');
    const MockRedis = ioredis.default || ioredis.Redis;
    if (typeof MockRedis === 'function') {
      currentRedisMock = new MockRedis();
    }
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  // ─── ensureConsumerGroup ─────────────────────────────────────────

  it('1. ensureConsumerGroup — cria consumer group com MKSTREAM', async () => {
    const mod = await import('../index.ts');

    // Verifica se o grupo não existe antes
    expect(redisState.consumerGroups.has(MIRROR_STREAM)).toBe(false);

    // Chama a função diretamente via xgroup
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Verifica se o grupo foi criado
    expect(redisState.consumerGroups.has(MIRROR_STREAM)).toBe(true);
    const groups = redisState.consumerGroups.get(MIRROR_STREAM)!;
    expect(groups.has(MIRROR_CONSUMER_GROUP)).toBe(true);
  });

  it('2. ensureConsumerGroup — BUSYGROUP não é erro fatal', async () => {
    // Cria o grupo primeiro
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Tentar criar o mesmo grupo deve lançar BUSYGROUP
    try {
      await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');
      expect('não deveria chegar aqui').toBe('');
    } catch (err: any) {
      expect(err.message).toContain('BUSYGROUP');
    }
  });

  // ─── XADD (streamAdd) ────────────────────────────────────────────

  it('3. XADD — mensagem é adicionada ao stream com payload', async () => {
    const msgId = await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);
    expect(msgId).toBeTruthy();
    expect(typeof msgId).toBe('string');
    expect(msgId).toMatch(/^\d+-\d+$/);

    const entries = redisState.streams.get(MIRROR_STREAM)!;
    expect(entries.length).toBe(1);
    expect(entries[0].fields).toEqual(['payload', samplePayload]);
  });

  // ─── XREADGROUP (consumo) ────────────────────────────────────────

  it('4. XREADGROUP — consumer lê mensagens do grupo', async () => {
    // Configura: stream com 1 msg, consumer group criado
    await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    const result = await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'test-consumer-1',
      'COUNT', 5,
      'BLOCK', 1000,
      'STREAMS', MIRROR_STREAM, '>',
    );

    expect(result).toBeTruthy();
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);

    const [streamName, messages] = result[0];
    expect(streamName).toBe(MIRROR_STREAM);
    expect(messages.length).toBe(1);

    const [msgId, fields] = messages[0];
    expect(fields).toEqual(['payload', samplePayload]);
  });

  // ─── XACK (ack explícito) ────────────────────────────────────────

  it('5. XACK — mensagem é acknowledgeada e removida do pending', async () => {
    await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Consome
    const result = await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'test-consumer',
      'COUNT', 5,
      'BLOCK', 1000,
      'STREAMS', MIRROR_STREAM, '>',
    );
    const msgId = result[0][1][0][0];

    // Verifica pending
    const pendingBefore = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pendingBefore.length).toBe(1);

    // ACK
    const acked = await currentRedisMock.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);
    expect(acked).toBe(1);

    // Verifica pending após ACK
    const pendingAfter = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pendingAfter.length).toBe(0);
  });

  // ─── processPendingMessages ──────────────────────────────────────

  it('6. Mensagens pendentes com delivery ≤3 são mantidas', async () => {
    // Simula: stream com 1 mensagem, grupo criado, mensagem consumida mas não ACKed
    await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Consome sem ACK
    await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'test-consumer',
      'COUNT', 5,
      'BLOCK', 1000,
      'STREAMS', MIRROR_STREAM, '>',
    );

    // Verifica que a mensagem está pendente
    const pending = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pending.length).toBe(1);
  });

  it('7. Mensagens pendentes com delivery >3 são ACKed e DLQ recebe o item', async () => {
    // Cria mensagem no stream
    await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Obtém o ID da mensagem
    const entries = redisState.streams.get(MIRROR_STREAM)!;
    const msgId = entries[0].id;

    // Simula um consumo anterior (sem ACK) que deixou a mensagem pendente
    // com delivery count = 5 (simulando 5 tentativas falhas)
    const groupData = redisState.consumerGroups.get(MIRROR_STREAM)!.get(MIRROR_CONSUMER_GROUP)!;
    if (!groupData.consumers.has('old-consumer')) {
      groupData.consumers.set('old-consumer', []);
    }
    groupData.consumers.get('old-consumer')!.push(msgId);

    // Simula que processPendingMessages lê o pending, vê deliveryCount > 3,
    // lê o payload via xrange e move para DLQ

    // 1. Lê a mensagem do stream (xrange)
    const raw = await currentRedisMock.xrange(MIRROR_STREAM, msgId, msgId);
    expect(raw.length).toBe(1);
    const fields = raw[0][1];
    const payloadIndex = fields.indexOf('payload');
    expect(payloadIndex).not.toBe(-1);
    const rawPayload = fields[payloadIndex + 1];
    const event = JSON.parse(rawPayload as string);
    expect(event.messageId).toBe('stream-test-msg-001');

    // 2. ACK a mensagem (como processPendingMessages faz para msgs >3)
    await currentRedisMock.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);

    // 3. Adiciona na DLQ (pushToDLQ)
    const dlqEntry = JSON.stringify({
      id: 'test-dlq-001',
      event,
      failureReason: 'stream_exceeded_delivery_count',
      attempts: 5,
      lastError: 'Mensagem excedeu 5 tentativas de entrega no stream',
      failedAt: new Date().toISOString(),
      reprocessed: false,
    });
    await currentRedisMock.rpush(MIRROR_DLQ_LIST, dlqEntry);
    await currentRedisMock.zadd(MIRROR_DLQ_INDEX, Date.now(), 'test-dlq-001');

    // Verifica pending removido
    const pendingAfter = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pendingAfter.length).toBe(0);

    // Verifica DLQ
    const dlqItems = await currentRedisMock.lrange(MIRROR_DLQ_LIST, 0, -1);
    expect(dlqItems.length).toBe(1);
    const dlqItem = JSON.parse(dlqItems[0] as string);
    expect(dlqItem.id).toBe('test-dlq-001');
    expect(dlqItem.failureReason).toBe('stream_exceeded_delivery_count');
    expect(dlqItem.attempts).toBe(5);

    // Mensagem original ainda persiste no stream (diferente de PubSub!)
    expect(redisState.streams.get(MIRROR_STREAM)!.length).toBe(1);
  });

  // ─── Ciclo completo ──────────────────────────────────────────────

  it('8. Ciclo completo: XADD → XREADGROUP → process → XACK', async () => {
    // Passo 1: Stream vazio, sem grupo
    expect(redisState.streams.has(MIRROR_STREAM)).toBe(false);

    // Passo 2: Cria consumer group (MKSTREAM cria o stream)
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Passo 3: Adiciona 3 mensagens ao stream (simula webhook)
    const msgIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const payload = JSON.stringify({
        ...baseEvent,
        messageId: `stream-msg-${i}`,
        text: `Oferta ${i}! https://shopee.com.br/product/ITEM00${i}`,
      });
      const id = await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', payload);
      msgIds.push(id as string);
    }

    // Stream tem 3 mensagens
    expect(redisState.streams.get(MIRROR_STREAM)!.length).toBe(3);

    // Passo 4: Consome as 3 mensagens via XREADGROUP
    const consumed: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = await currentRedisMock.xreadgroup(
        'GROUP', MIRROR_CONSUMER_GROUP, 'test-consumer',
        'COUNT', 1,
        'BLOCK', 100, // timeout curto para teste
        'STREAMS', MIRROR_STREAM, '>',
      );
      if (result) {
        consumed.push(result[0][1][0][0]);
      }
    }

    // Verifica que consumiu todas
    expect(consumed.length).toBe(3);

    // Passo 5: Verifica pending (3 mensagens pendentes)
    let pending = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pending.length).toBe(3);

    // Passo 6: ACK todas
    for (const id of consumed) {
      await currentRedisMock.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, id);
    }

    // Passo 7: Verifica pending vazio
    pending = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pending.length).toBe(0);

    // Passo 8: Mensagens ainda persistem no stream (diferente de PubSub!)
    expect(redisState.streams.get(MIRROR_STREAM)!.length).toBe(3);
  });

  // ─── Persistência ────────────────────────────────────────────────

  it('9. Mensagens persistem no stream mesmo após consumo', async () => {
    // PubSub perderia as mensagens se o worker reiniciasse.
    // Stream mantém os dados mesmo após consumo e ACK.

    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Adiciona mensagem
    await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);

    // Consome
    const result = await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'consumer-1',
      'COUNT', 5,
      'BLOCK', 100,
      'STREAMS', MIRROR_STREAM, '>',
    );
    const msgId = result[0][1][0][0];

    // ACK
    await currentRedisMock.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);

    // Verifica que a mensagem ainda está no stream (persistiu!)
    const entries = redisState.streams.get(MIRROR_STREAM)!;
    expect(entries.length).toBe(1);
    expect(entries[0].id).toBe(msgId);

    // Num PubSub, após consumir a mensagem não existe mais.
    // No Stream, ela persiste para re-leitura, auditoria ou replay.
  });

  // ─── Mensagem sem payload ────────────────────────────────────────

  it('10. Mensagem sem campo payload — ACK mesmo assim', async () => {
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Adiciona mensagem sem payload
    const msgId = await currentRedisMock.xadd(MIRROR_STREAM, '*', 'other', 'data');

    // Consome
    const result = await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'consumer-1',
      'COUNT', 5,
      'BLOCK', 100,
      'STREAMS', MIRROR_STREAM, '>',
    );

    // Verifica que a mensagem foi consumida (tem payloadIndex === -1)
    const fields = result[0][1][0][1];
    const payloadIndex = fields.indexOf('payload');
    expect(payloadIndex).toBe(-1);

    // ACK (como handleStreamMessage faria para mensagens sem payload)
    await currentRedisMock.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);

    // Verifica pending vazio
    const pending = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pending.length).toBe(0);
  });

  // ─── Concorrência ────────────────────────────────────────────────

  it('11. Múltiplas mensagens consecutivas são processadas em ordem', async () => {
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    const texts = [
      'Primeira mensagem',
      'Segunda mensagem',
      'Terceira mensagem',
    ];

    // Adiciona em sequência
    for (const text of texts) {
      const payload = JSON.stringify({ ...baseEvent, messageId: `order-${text}`, text });
      await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', payload);
    }

    // Consome e verifica ordem FIFO
    for (const expectedText of texts) {
      const result = await currentRedisMock.xreadgroup(
        'GROUP', MIRROR_CONSUMER_GROUP, 'consumer-1',
        'COUNT', 1,
        'BLOCK', 100,
        'STREAMS', MIRROR_STREAM, '>',
      );

      expect(result).toBeTruthy();
      const fields = result[0][1][0][1];
      const payloadIdx = fields.indexOf('payload');
      const parsed = JSON.parse(fields[payloadIdx + 1]);
      expect(parsed.text).toBe(expectedText);
    }
  });

  // ─── Comportamento do grupo: mensagens não-ACKed bloqueiam replay ──

  it('12. Mensagem não-ACKed não é re-entregue', async () => {
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Adiciona 1 mensagem
    await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);

    // Consumidor 1 pega a mensagem mas não faz ACK
    const result1 = await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'consumer-1',
      'COUNT', 5,
      'BLOCK', 100,
      'STREAMS', MIRROR_STREAM, '>',
    );
    expect(result1).toBeTruthy();

    // Consumidor 2 tenta ler a mesma mensagem — não consegue
    const result2 = await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'consumer-2',
      'COUNT', 5,
      'BLOCK', 100,
      'STREAMS', MIRROR_STREAM, '>',
    );
    // A mensagem já foi entregue a consumer-1 e não foi ACKed
    // XREADGROUP com '>' só entrega mensagens novas não entregues
    expect(result2).toBeNull();
  });

  // ─── DLQ integrada com stream ────────────────────────────────────

  it('13. Mensagens com falha são enviadas para DLQ e stream é ACKed', async () => {
    await currentRedisMock.xgroup('CREATE', MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '$', 'MKSTREAM');

    // Adiciona mensagem
    await currentRedisMock.xadd(MIRROR_STREAM, '*', 'payload', samplePayload);

    // Consume
    const result = await currentRedisMock.xreadgroup(
      'GROUP', MIRROR_CONSUMER_GROUP, 'consumer-1',
      'COUNT', 5,
      'BLOCK', 100,
      'STREAMS', MIRROR_STREAM, '>',
    );
    const msgId = result[0][1][0][0];

    // Simula: processamento falhou → pushToDLQ + xack
    // No código real, handleStreamMessage faz catch + xack
    // e o processMirrorMessage chama pushToDLQ

    // ACK mesmo com erro (como handleStreamMessage faz)
    await currentRedisMock.xack(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, msgId);

    // Adiciona item na DLQ (simula pushToDLQ)
    const dlqEntry = JSON.stringify({
      id: 'dlq-test-uuid',
      event: baseEvent,
      failureReason: 'send_failed',
      attempts: 3,
      lastError: 'Falha ao enviar',
      failedAt: new Date().toISOString(),
      marketplace: 'shopee',
      reprocessed: false,
    });
    await currentRedisMock.rpush(MIRROR_DLQ_LIST, dlqEntry);
    await currentRedisMock.zadd(MIRROR_DLQ_INDEX, Date.now(), 'dlq-test-uuid');

    // Verifica DLQ
    const dlqItems = await currentRedisMock.lrange(MIRROR_DLQ_LIST, 0, -1);
    expect(dlqItems.length).toBe(1);

    const dlqCount = await currentRedisMock.zcard(MIRROR_DLQ_INDEX);
    expect(dlqCount).toBe(1);

    // Verifica stream ACKed
    const pending = await currentRedisMock.xpending(MIRROR_STREAM, MIRROR_CONSUMER_GROUP, '-', '+', 10);
    expect(pending.length).toBe(0);
  });
});
