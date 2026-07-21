/**
 * Helpers compartilhados para os testes E2E.
 */

const API_BASE = process.env.API_URL || 'http://localhost:5446';

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

/**
 * Faz uma requisição GET autenticada.
 */
export async function authGet(path: string, token: string, baseUrl = API_BASE) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Faz uma requisição POST autenticada.
 */
export async function authPost(
  path: string,
  token: string,
  body: Record<string, unknown>,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Faz uma requisição PUT autenticada.
 */
export async function authPut(
  path: string,
  token: string,
  body: Record<string, unknown>,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}
