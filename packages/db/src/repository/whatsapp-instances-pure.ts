/**
 * Lógica PURA do repositório de instâncias WhatsApp.
 *
 * Separa:
 *  - a normalização do retorno de `.returning()` do Drizzle (`ensureArray`),
 *    que em drizzle-orm ^0.38 com driver postgres pode retornar um objeto
 *    vazio `{}` em vez de array `[{...}]`;
 *  - o mapeamento para dados públicos (remoção de apiKey).
 * Funções síncronas, 100% testáveis sem PostgreSQL.
 */

/**
 * Normaliza o retorno de `.returning()` do Drizzle.
 * Em drizzle-orm ^0.38 com driver postgres, UPDATE/DELETE .returning()
 * pode retornar um objeto vazio `{}` em vez de array `[{...}]`.
 *
 *  - se for array, retorna como está;
 *  - se for objeto com chaves, envolve em [result];
 *  - se for objeto vazio `{}`, retorna [].
 */
export function ensureArray<T>(result: T | T[]): T[] {
  if (Array.isArray(result)) return result;
  // Drizzle postgres driver retorna {} ou { ...row } diretamente
  return Object.keys(result as object).length > 0 ? [result] : [];
}

export interface WhatsAppInstancePublic {
  id: number;
  userId: number;
  instanceId: string;
  channelType: string;
  rateLimitMaxMsgs: number;
  rateLimitWindowSec: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Converte para dados públicos (remove apiKey).
 */
export function toPublic(row: {
  id: number;
  userId: number;
  instanceId: string;
  channelType: string;
  rateLimitMaxMsgs: number;
  rateLimitWindowSec: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  apiKey: string;
}): WhatsAppInstancePublic {
  return {
    id: row.id,
    userId: row.userId,
    instanceId: row.instanceId,
    channelType: row.channelType,
    rateLimitMaxMsgs: row.rateLimitMaxMsgs,
    rateLimitWindowSec: row.rateLimitWindowSec,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
