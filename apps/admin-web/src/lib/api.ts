/**
 * Client HTTP do admin-api — token de sessão em localStorage.
 *
 * Chave: oma_admin_token (espelha omestre_auth_token do apps/web).
 */

import type { AggregatedWorkerStatus, DLQListResponse } from './worker-status.ts';

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

// ─── Feature Flags ────────────────────────────────────────────────────────

export interface FlagData {
  key: string;
  label: string;
  description: string;
  category: string;
  enabled: boolean;
  danger: boolean;
  checksLastHour: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export async function listFlags(): Promise<FlagData[]> {
  const data = await request<{ success: true; flags: FlagData[] }>('/api/admin/feature-flags');
  return data.flags;
}

export async function toggleFlag(key: string, enabled: boolean): Promise<void> {
  await request<{ success: true; flag: unknown }>(`/api/admin/feature-flags/${key}`, {
    method: 'PATCH',
    body: JSON.stringify({ enabled }),
  });
}

// ─── Worker Status ────────────────────────────────────────────────────────
//
// Re-export dos tipos do helper para evitar re-tipagem local. Os endpoints
// ficam em /api/admin/worker/* (rotas protegidas por sessão).

export type {
  AggregatedWorkerStatus,
  ServiceStatus,
  DLQEntry,
  DLQEvent,
  DLQListResponse,
} from './worker-status.ts';

export interface DlqFilters {
  offset?: number;
  limit?: number;
  queue?: 'A' | 'B';
  reason?: string;
  since?: number;
}

export async function getWorkerStatus(): Promise<AggregatedWorkerStatus> {
  return request<AggregatedWorkerStatus>('/api/admin/worker/status');
}

export async function listDlq(filters: DlqFilters = {}): Promise<DLQListResponse> {
  const params = new URLSearchParams();
  if (filters.offset != null) params.set('offset', String(filters.offset));
  if (filters.limit != null) params.set('limit', String(filters.limit));
  if (filters.queue) params.set('queue', filters.queue);
  if (filters.reason) params.set('reason', filters.reason);
  if (filters.since != null) params.set('since', String(filters.since));
  const qs = params.toString();
  return request<DLQListResponse>(`/api/admin/worker/dlq${qs ? `?${qs}` : ''}`);
}

export async function requeueDlq(id: string): Promise<{ success: true; targetStream: string }> {
  return request<{ success: true; targetStream: string }>(
    `/api/admin/worker/dlq/requeue?id=${encodeURIComponent(id)}`,
    { method: 'POST' },
  );
}

export async function removeDlq(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/api/admin/worker/dlq/remove?id=${encodeURIComponent(id)}`,
    { method: 'POST' },
  );
}

export async function purgeDlq(): Promise<{ success: true; removed: number }> {
  return request<{ success: true; removed: number }>('/api/admin/worker/dlq/purge', {
    method: 'POST',
  });
}
