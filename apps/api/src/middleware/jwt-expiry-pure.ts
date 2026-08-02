/**
 * Helper para calcular expiração de tokens JWT — Item #6 da análise.
 *
 * Garante que todo JWT emitido tem `exp` definido, evitando tokens
 * que nunca expiram (vetor de ataque permanente em caso de leak).
 *
 * Token lifetime: 7 dias (604.800 segundos).
 */
export const JWT_EXPIRATION_SECONDS = 7 * 24 * 60 * 60;

export function buildJwtExpiry(now: number = Date.now()): number {
  return Math.floor(now / 1000) + JWT_EXPIRATION_SECONDS;
}
