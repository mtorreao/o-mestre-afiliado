/**
 * Helper puro para resolução das origens permitidas no CORS — Item #5 da análise.
 *
 * Lógica:
 *   - Em produção: apenas FRONTEND_URL é permitida
 *   - Em dev: FRONTEND_URL + localhost em portas comuns
 *
 * Sem esse helper, o CORS ficava `cors()` aberto (qualquer origin).
 */

const DEV_ORIGINS = [
  'http://localhost:5441',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5441',
  'http://127.0.0.1:5173',
];

export function getAllowedCorsOrigins(
  frontendUrl: string | undefined,
  nodeEnv: string | undefined,
): string[] {
  const origins: string[] = [];
  if (frontendUrl) origins.push(frontendUrl);

  if (nodeEnv !== 'production') {
    for (const o of DEV_ORIGINS) {
      if (!origins.includes(o)) origins.push(o);
    }
  }

  return origins;
}
