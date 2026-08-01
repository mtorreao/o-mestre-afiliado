import { describe, it, expect } from 'bun:test';

// ─── Tipos auxiliares para os doubles ──────────────────────────────────────
//
// Os doubles abaixo simulam a API pública mínima do ioredis que o client.ts
// consome (incr/expire/mget/publish/duplicate/subscribe/on). Determinísticos:
// sem timers reais pendurados após cada teste.

type SubCallback = (err: Error | null) => void;
type MessageHandler = (channel: string, message: string) => void;

export interface FakeSubscriber {
  subscribe: (channel: string, cb?: SubCallback) => void;
  unsubscribe: () => void;
  on: (event: 'message', handler: MessageHandler) => void;
}

export interface FakeRedis {
  incr: (key: string) => unknown;
  expire: (key: string, seconds: number) => unknown;
  mget: (...keys: string[]) => Promise<(string | null)[]>;
  publish: (channel: string, message: string) => unknown;
  duplicate: () => FakeSubscriber;
}

export interface FakeRedisHandle {
  redis: FakeRedis;
  subscriber: FakeSubscriber;
  // Estado observável
  state: {
    incrCalls: { key: string }[];
    expireCalls: { key: string; seconds: number }[];
    mgetCalls: { keys: string[] };
    publishCalls: { channel: string; message: string }[];
    subscribeCalls: { channel: string; withCallback: boolean }[];
    unsubscribeCalls: number;
    messages: MessageHandler[];
    // Controle de mget: índice → valor retornado
    mgetOverrides: Map<number, string | null>;
    // Quando definido, mget lança com esta mensagem
    mgetThrowsWith: string | null;
  };
  // Helper: entrega mensagens como se viessem do PubSub
  emitMessage: (channel: string, message: string) => void;
  // Helper: faz o PRÓXIMO subscribe falhar (callback com erro)
  makeSubscribeFailWith: (message: string) => void;
  // Helper: define retorno de mget por índice da chave
  setMgetResult: (index: number, value: string | null) => void;
  // Helper: faz o PRÓXIMO mget lançar
  makeMgetThrowWith: (message: string) => void;
  // Helper: faz o PRÓXIMO incr lançar
  makeIncrThrowWith: (message: string) => void;
  // Helper: faz o PRÓXIMO publish lançar
  makePublishThrowWith: (message: string) => void;
}

/**
 * Cria um double determinístico de ioredis. Permite inspecionar chamadas,
 * simular respostas e simular falhas controladas — sem timers pendurados.
 */
export function createFakeRedis(): FakeRedisHandle {
  let subscribeError: string | null = null;
  let mgetError: string | null = null;
  let incrError: string | null = null;
  let publishError: string | null = null;
  const messageHandlers: MessageHandler[] = [];

  const subscriber: FakeSubscriber = {
    subscribe: (_channel: string, cb?: SubCallback) => {
      handle.state.subscribeCalls.push({
        channel: _channel,
        withCallback: typeof cb === 'function',
      });
      if (cb) {
        if (subscribeError) {
          const err = subscribeError;
          subscribeError = null;
          cb(new Error(err));
        } else {
          cb(null);
        }
      }
    },
    unsubscribe: () => {
      handle.state.unsubscribeCalls++;
    },
    on: (_event: 'message', handler: MessageHandler) => {
      messageHandlers.push(handler);
    },
  };

  const redis: FakeRedis = {
    incr: (key) => {
      handle.state.incrCalls.push({ key });
      if (incrError) {
        const err = incrError;
        incrError = null;
        throw new Error(err);
      }
      return 1;
    },
    expire: (key, seconds) => {
      handle.state.expireCalls.push({ key, seconds });
      return 1;
    },
    mget: async (...keys: string[]) => {
      handle.state.mgetCalls = { keys };
      if (mgetError) {
        const err = mgetError;
        mgetError = null;
        throw new Error(err);
      }
      return keys.map((_, idx) => {
        const ov = handle.state.mgetOverrides.get(idx);
        return ov === undefined ? '1' : ov;
      });
    },
    publish: (channel, message) => {
      handle.state.publishCalls.push({ channel, message });
      if (publishError) {
        const err = publishError;
        publishError = null;
        throw new Error(err);
      }
      return 1;
    },
    duplicate: () => subscriber,
  };

  const handle: FakeRedisHandle = {
    redis,
    subscriber,
    state: {
      incrCalls: [],
      expireCalls: [],
      mgetCalls: { keys: [] },
      publishCalls: [],
      subscribeCalls: [],
      unsubscribeCalls: 0,
      messages: messageHandlers,
      mgetOverrides: new Map(),
      mgetThrowsWith: null,
    },
    emitMessage: (channel, message) => {
      // Cópia para permitir handlers se desregistrarem durante a iteração
      for (const h of [...messageHandlers]) h(channel, message);
    },
    makeSubscribeFailWith: (message: string) => {
      subscribeError = message;
    },
    setMgetResult: (index, value) => {
      handle.state.mgetOverrides.set(index, value);
    },
    makeMgetThrowWith: (message: string) => {
      mgetError = message;
    },
    makeIncrThrowWith: (message: string) => {
      incrError = message;
    },
    makePublishThrowWith: (message: string) => {
      publishError = message;
    },
  };

  return handle;
}

/**
 * Helper para resetar estado entre testes (sem criar novo handle).
 */
export function resetFakeRedis(handle: FakeRedisHandle): void {
  handle.state.incrCalls.length = 0;
  handle.state.expireCalls.length = 0;
  handle.state.mgetCalls = { keys: [] };
  handle.state.publishCalls.length = 0;
  handle.state.subscribeCalls.length = 0;
  handle.state.unsubscribeCalls = 0;
  handle.state.messages.length = 0;
  handle.state.mgetOverrides.clear();
  handle.state.mgetThrowsWith = null;
}

describe('createFakeRedis (sanity)', () => {
  it('instancia estado vazio', () => {
    const h = createFakeRedis();
    expect(h.state.incrCalls).toHaveLength(0);
    expect(h.state.expireCalls).toHaveLength(0);
    expect(h.state.mgetCalls.keys).toHaveLength(0);
    expect(h.state.publishCalls).toHaveLength(0);
  });

  it('resetFakeRedis limpa estado', () => {
    const h = createFakeRedis();
    h.redis.incr('x');
    h.redis.publish('c', 'm');
    expect(h.state.incrCalls).toHaveLength(1);
    resetFakeRedis(h);
    expect(h.state.incrCalls).toHaveLength(0);
    expect(h.state.publishCalls).toHaveLength(0);
  });
});
