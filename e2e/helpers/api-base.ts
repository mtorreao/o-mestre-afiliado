/**
 * Helpers de base para os testes E2E: URL da API, identidade de teste e
 * criacao de usuario via /api/auth/register. Usado por todos os specs
 * (api e ui) que precisam de um usuario de teste novo.
 */

export const API_BASE =
  process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

/**
 * Gera um email único para cada execução de teste.
 */
export function uniqueEmail(): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `test-${ts}-${rand}@e2e.local`;
}

export const TEST_PASSWORD = 'Test@123456';
export const TEST_NAME = 'Teste E2E';

/**
 * Cria um usuário via API e retorna o token JWT.
 */
export async function createTestUser(baseUrl = API_BASE): Promise<{
  token: string;
  user: { id: number; email: string; name: string };
  email: string;
}> {
  const email = uniqueEmail();
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`register failed: ${res.status} ${JSON.stringify(body)}`);
  }
  const data = (await res.json()) as {
    success: boolean;
    token: string;
    user: { id: number; email: string; name: string };
  };
  return { token: data.token, user: data.user, email };
}
