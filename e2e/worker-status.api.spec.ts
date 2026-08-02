/**
 * Testes E2E de API — Worker Status + Dead Letter Queue (arquitetura v2)
 *
 * Cobre os endpoints introduzidos/adaptados na refatoração do worker
 * (Ingestor + Dispatcher + worker-common):
 *
 *   GET  /api/worker/status        — agregador Ingestor + Dispatcher + XLEN filas
 *   GET  /api/worker/dlq           — lista DLQ com filtros server-side
 *   POST /api/worker/dlq/requeue   — re-enfileira (A ou B conforme tipo do evento)
 *   POST /api/worker/dlq/remove    — remove item da DLQ
 *   POST /api/worker/dlq/purge     — limpa itens antigos da DLQ
 *
 * Requer: API rodando em http://localhost:15442 (E2E stack — plano padrão).
 *
 * Notas de robustez:
 *   - /api/worker/status NÃO exige que os serviços de métrica (9092/9093)
 *     estejam alcançáveis a partir do container da API. Validamos o SHAPE
 *     da resposta; `reachable` pode ser true ou false no ambiente E2E.
 *   - A DLQ é compartilhada no Redis — as operações não dependem de nenhum
 *     serviço worker estar de pé.
 */

import { test, expect } from '@playwright/test';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

// /api/worker/* exige super admin (ADMIN_EMAILS + is_admin no DB).
// No E2E, o compose define ADMIN_EMAILS=e2e-admin@e2e.local; o register
// promove o usuário a admin automaticamente via isEmailAdminAllowed.
const ADMIN_EMAIL = 'e2e-admin@e2e.local';
const ADMIN_PASSWORD = 'Test@123456';

async function getAdminToken(): Promise<string> {
  // Tenta login primeiro (idempotente entre execuções); se falhar, registra.
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (loginRes.ok) {
    const data = (await loginRes.json()) as { token: string };
    return data.token;
  }
  const regRes = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      name: 'E2E Admin',
      password: ADMIN_PASSWORD,
    }),
  });
  if (!regRes.ok) {
    const body = await regRes.json().catch(() => ({}));
    throw new Error(`admin register failed: ${regRes.status} ${JSON.stringify(body)}`);
  }
  const data = (await regRes.json()) as { token: string };
  return data.token;
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAdminToken();
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

// ─── GET /api/worker/status ──────────────────────────────────────────

test.describe('Worker Status — Agregador (Ingestor + Dispatcher)', () => {
  test('GET /api/worker/status retorna shape agregado', async () => {
    const res = await authFetch('/api/worker/status');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      success: boolean;
      services: Array<{ name: string; reachable: boolean }>;
      pipeline: { queueA: number | null; queueB: number | null };
    };

    expect(body.success).toBe(true);

    // Dois serviços na ordem: ingestor, dispatcher
    expect(Array.isArray(body.services)).toBe(true);
    expect(body.services).toHaveLength(2);
    const names = body.services.map((s) => s.name).sort();
    expect(names).toEqual(['dispatcher', 'ingestor']);
    for (const svc of body.services) {
      expect(typeof svc.reachable).toBe('boolean');
    }

    // Profundidade das duas filas (número quando Redis está up, null se não)
    expect(body.pipeline).toBeDefined();
    expect(body.pipeline.queueA === null || typeof body.pipeline.queueA === 'number').toBe(true);
    expect(body.pipeline.queueB === null || typeof body.pipeline.queueB === 'number').toBe(true);
  });
});

// ─── GET /api/worker/dlq ─────────────────────────────────────────────

test.describe('Worker DLQ — Listagem', () => {
  test('GET /api/worker/dlq retorna estrutura paginada', async () => {
    const res = await authFetch('/api/worker/dlq');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      items: unknown[];
      total: number;
      totalFiltered: number;
      offset: number;
      limit: number;
    };

    expect(Array.isArray(body.items)).toBe(true);
    expect(typeof body.total).toBe('number');
    expect(typeof body.totalFiltered).toBe('number');
  });

  test('GET /api/worker/dlq aceita filtros server-side (queue, since)', async () => {
    const res = await authFetch('/api/worker/dlq?queue=A&since=24h&limit=50');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });

  test('GET /api/worker/dlq com since ISO não quebra', async () => {
    const res = await authFetch(
      `/api/worker/dlq?since=${encodeURIComponent('2020-01-01T00:00:00Z')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(body.items)).toBe(true);
  });
});

// ─── POST /api/worker/dlq/* ──────────────────────────────────────────

test.describe('Worker DLQ — Operações', () => {
  test('POST /api/worker/dlq/requeue sem id retorna 400', async () => {
    const res = await authFetch('/api/worker/dlq/requeue', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  test('POST /api/worker/dlq/requeue id inexistente retorna success=false', async () => {
    // Por convenção do projeto (AGENTS.md), erros de negócio NÃO retornam 4xx —
    // sempre HTTP 200 com { success: false }.
    const res = await authFetch(`/api/worker/dlq/requeue?id=nao-existe-${Date.now()}`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  test('POST /api/worker/dlq/remove sem id retorna 400', async () => {
    const res = await authFetch('/api/worker/dlq/remove', { method: 'POST' });
    expect(res.status).toBe(400);
  });

  test('POST /api/worker/dlq/remove id inexistente retorna false', async () => {
    const res = await authFetch(`/api/worker/dlq/remove?id=nao-existe-${Date.now()}`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as boolean;
    expect(body).toBe(false);
  });

  test('POST /api/worker/dlq/purge retorna número (itens removidos)', async () => {
    const res = await authFetch('/api/worker/dlq/purge', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as number;
    expect(typeof body).toBe('number');
  });
});
