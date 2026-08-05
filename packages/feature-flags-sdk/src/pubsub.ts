/**
 * PubSub para invalidação de cache de feature flags.
 *
 * Canal: `omestre:flag:invalidate` — payload é a `key` da flag a invalidar.
 * Funciona como broadcast: quem publica não fica esperando retorno, e quem
 * assina invalida seu cache local quando recebe a mensagem.
 *
 * Best-effort: falhas de Redis (offline, publish falhou) são silenciosas.
 */

import { getFlagRedis } from './redis.ts';
import { FLAG_INVALIDATE_CHANNEL } from './keys.ts';

export type InvalidateCallback = (flagKey: string) => void;

/**
 * Publica `key` no canal `omestre:flag:invalidate` para notificar outros
 * processos que devem invalidar o cache local.
 */
export function publishFlagInvalidation(key: string, redisUrl?: string): boolean {
  const r = getFlagRedis(redisUrl);
  if (!r) return false;
  try {
    // Sem await — broadcast fire-and-forget. Erros não bloqueiam a caller.
    r.publish(FLAG_INVALIDATE_CHANNEL, key).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

/**
 * Assina o canal de invalidação. `cb` é chamada com a `key` sempre que uma
 * mensagem chega.
 *
 * Retorna uma função `unsubscribe()` que o caller deve chamar para limpar
 * a conexão (importante em testes para não vazar processos do ioredis-mock).
 *
 * Retorna `null` se Redis indisponível — caller pode degradar gracefully.
 */
export async function subscribeFlagInvalidation(
  cb: InvalidateCallback,
  redisUrl?: string,
): Promise<(() => Promise<void>) | null> {
  const r = getFlagRedis(redisUrl);
  if (!r) return null;

  // ioredis: subscribe precisa estar em uma conexão separada da principal.
  // `duplicate()` cria uma cópia que compartilha as opções mas tem buffer próprio.
  const subscriber = (
    r as unknown as {
      duplicate: () => {
        subscribe: (ch: string) => Promise<unknown>;
        on: (e: string, cb: (...args: unknown[]) => void) => void;
        unsubscribe: (ch?: string) => Promise<unknown>;
        quit: () => Promise<unknown>;
        status?: string;
      };
    }
  ).duplicate();
  if (subscriber.status === 'end' || subscriber.status === 'close') {
    return null;
  }

  await subscriber.subscribe(FLAG_INVALIDATE_CHANNEL);
  subscriber.on('message', (_channel, message) => {
    cb(String(message));
  });

  return async () => {
    try {
      await subscriber.unsubscribe(FLAG_INVALIDATE_CHANNEL);
    } catch {
      // ignora
    }
    try {
      await subscriber.quit();
    } catch {
      // ignora
    }
  };
}
