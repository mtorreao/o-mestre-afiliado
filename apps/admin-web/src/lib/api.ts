/**
 * Client HTTP do admin-api — token de sessão em localStorage.
 *
 * Chave: oma_admin_token (espelha omestre_auth_token do apps/web).
 */

const TOKEN_KEY = 'oma_admin_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiError {
  success: false;
  error: string;
}

export interface DeployRecord {
  id: string;
  ref: string;
  sha: string;
  triggeredBy: 'github' | 'manual';
  status: 'running' | 'success' | 'failed' | 'timeout';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  logKey: string | null;
  summary: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (res.status === 401) {
    clearToken();
    throw new Error('unauthorized');
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }

  return (await res.json()) as T;
}

export async function login(user: string, password: string): Promise<string> {
  const basic = btoa(`${user}:${password}`);
  const res = await fetch('/api/admin/auth/login', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error ?? 'login falhou');
  }
  const data = (await res.json()) as { success: true; token: string };
  setToken(data.token);
  return data.token;
}

export async function logout(): Promise<void> {
  try {
    await request('/api/admin/auth/logout', { method: 'POST' });
  } catch {
    // ignora erro no logout (token já é limpo localmente)
  }
  clearToken();
}

export async function checkSession(): Promise<boolean> {
  try {
    await request<{ success: true }>('/api/admin/auth/me');
    return true;
  } catch {
    return false;
  }
}

export async function listDeploys(): Promise<DeployRecord[]> {
  const data = await request<{ success: true; deploys: DeployRecord[] }>('/api/admin/deploys');
  return data.deploys;
}

export async function getDeployLog(id: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`/api/admin/deploys/${id}/log`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export async function triggerManualDeploy(ref: string, sha: string): Promise<{ deployId: string }> {
  return request<{ success: true; deployId: string }>('/api/admin/deploys', {
    method: 'POST',
    body: JSON.stringify({ ref, sha }),
  });
}

export async function testTelegram(): Promise<boolean> {
  const data = await request<{ success: boolean }>('/api/admin/test-telegram', {
    method: 'POST',
  });
  return data.success;
}
