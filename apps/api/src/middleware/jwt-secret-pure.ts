/**
 * Helper puro para resolução do JWT secret — Item #4 da análise.
 *
 * Extraído de auth.ts para que seja testável sem dependência do @elysiajs/jwt.
 * Lógica:
 *   - Se JWT_SECRET env var está configurada: usa ela
 *   - Senão em produção: lança erro (fail-closed)
 *   - Senão em dev: gera secret aleatório (não persistente entre restarts)
 *
 * O secret hardcoded antigo `'omestre-dev-secret-change-in-production'`
 * foi removido — era explorável se alguém deployar sem .env.
 */

export function resolveJwtSecret(
  envVar: string | undefined,
  nodeEnv: string | undefined,
): { secret: string; isRandomDev: boolean } {
  if (envVar && envVar.length > 0) {
    return { secret: envVar, isRandomDev: false };
  }

  const isDev = nodeEnv !== 'production';
  if (!isDev) {
    throw new Error('JWT_SECRET is required in production');
  }

  // Gera secret aleatório em dev (tokens não sobrevivem restarts — intencional)
  return { secret: crypto.randomUUID(), isRandomDev: true };
}
