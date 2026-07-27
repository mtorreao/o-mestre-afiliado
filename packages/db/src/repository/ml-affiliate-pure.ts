/**
 * Lógica PURA do repositório de afiliados Mercado Livre.
 *
 * Separa a formatação de sumário e cálculo de expiração (que não dependem
 * de DB nem de criptografia) das operações de I/O. Funções síncronas,
 * 100% testáveis sem PostgreSQL.
 */
import type { MlAffiliate, MlAffiliateSummary } from './mlAffiliates.repository.ts';

/**
 * Calcula a data de expiração a partir de `expiresIn` (segundos).
 * `now` é injetável para testes determinísticos.
 */
export function computeExpiresAt(expiresIn: number, now: number = Date.now()): Date {
  return new Date(now + expiresIn * 1000);
}

/**
 * Indica se o token do afiliado está expirado em relação a `now`.
 */
export function isMlTokenExpired(expiresAt: Date, now: number = Date.now()): boolean {
  return expiresAt.getTime() < now;
}

/**
 * Constrói o sumário de listagem (sem tokens sensíveis), computando
 * o flag `expired` e `hasSessionCookies` a partir do modelo persistido.
 * `now` é injetável para testes determinísticos.
 */
export function toMlSummaryPure(r: MlAffiliate, now: number = Date.now()): MlAffiliateSummary {
  return {
    mlUserId: r.mlUserId,
    nickname: r.nickname,
    connectedAt: r.connectedAt,
    lastUsedAt: r.lastUsedAt,
    expiresAt: r.expiresAt,
    expired: isMlTokenExpired(r.expiresAt, now),
    meliid: r.meliid,
    melitat: r.melitat,
    hasSessionCookies: !!r.sessionCookies,
  };
}
