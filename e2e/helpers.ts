/**
 * Helpers compartilhados para os testes E2E.
 */

const API_BASE = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

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
export async function authGet<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição POST autenticada.
 */
export async function authPost<TBody extends Record<string, unknown> = Record<string, unknown>>(
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
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição PUT autenticada.
 */
export async function authPut<TBody extends Record<string, unknown> = Record<string, unknown>>(
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
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição PATCH autenticada.
 */
export async function authPatch<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as TBody };
}

/**
 * Faz uma requisição DELETE autenticada.
 */
export async function authDelete<TBody extends Record<string, unknown> = Record<string, unknown>>(
  path: string,
  token: string,
  baseUrl = API_BASE,
) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as TBody };
}

// ─── Simulador WhatsApp (escopo por instanceName) ───────────────────
//
// Cada teste opera sobre seu proprio instanceName ("user-{id}"). Assim,
// workers paralelos nao colidem no estado global do simulador.

const SIMULATOR_BASE =
  process.env.SIMULATOR_URL || `http://localhost:${process.env.SIMULATOR_PORT || '15446'}`;

export async function resetSimulatorInstance(instanceName: string): Promise<void> {
  const url = new URL('/__admin/reset', SIMULATOR_BASE);
  url.searchParams.set('instanceName', instanceName);
  await fetch(url.toString(), { method: 'POST' });
}

export interface SimMessage {
  instanceName: string;
  number: string;
  text: string;
  hasMedia?: boolean;
  mediaUrl?: string;
}

export async function getSimulatorMessagesFor(instanceName: string): Promise<SimMessage[]> {
  const url = new URL('/__admin/messages', SIMULATOR_BASE);
  url.searchParams.set('instanceName', instanceName);
  const res = await fetch(url.toString());
  const data = (await res.json()) as { success: boolean; messages: SimMessage[] };
  return data.messages ?? [];
}

export async function waitForMessagesOnInstance(
  instanceName: string,
  predicate: (msgs: SimMessage[]) => boolean,
  timeoutMs = 20000,
  intervalMs = 1000,
): Promise<SimMessage[]> {
  const start = Date.now();
  let last: SimMessage[] = [];
  while (Date.now() - start < timeoutMs) {
    last = await getSimulatorMessagesFor(instanceName);
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}
