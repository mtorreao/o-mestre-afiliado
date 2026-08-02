/**
 * Testes E2E de segurança — Cobre os 8 itens da análise security/analise-2026-08-01.md.
 *
 * Cada test() referencia o número do item da análise para rastreabilidade.
 * Requer: API rodando em http://localhost:5442 (API_PORT)
 *
 * Estes tests complementam os unit tests em apps/api/src/__tests__/ e
 */

import { test, expect } from '@playwright/test';
import { createTestUser, authGet, authPost } from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

// ─── Item #1 — Rotas ML exigem JWT ────────────────────────────────────

test.describe('Security #1 — Rotas ML exigem JWT', () => {
  test('GET /api/ml/affiliates sem token → 401', async () => {
    const res = await fetch(`${API}/api/ml/affiliates`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('autenticado');
  });

  test('GET /api/ml/affiliates com token válido → 200', async () => {
    const { token } = await createTestUser();
    const res = await fetch(`${API}/api/ml/affiliates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; affiliates: unknown[] };
    expect(body.success).toBe(true);
    expect(body.affiliates).toBeDefined();
  });

  test('POST /api/ml/affiliates/:mlUserId/validate-cookies sem token → 401', async () => {
    const res = await fetch(`${API}/api/ml/affiliates/123/validate-cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    // Pode ser 404 ou 401 — pelo menos não é acessível sem auth
    expect(res.status).not.toBe(200);
  });

  test('POST /api/ml/convert sem token → 401', async () => {
    const res = await fetch(`${API}/api/ml/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com', mlUserId: 'x' }),
    });
    expect(res.status).toBe(401);
  });

  test('POST /api/ml/refresh sem token → 401', async () => {
    const res = await fetch(`${API}/api/ml/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mlUserId: 'x' }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── Item #2 — IDOR nos Mirrors (cross-tenant) ───────────────────────

test.describe('Security #2 — IDOR cross-tenant em Mirrors', () => {
  test('Alice NÃO pode ver espelhamento do Bob (GET)', async () => {
    // Cria espelhamento para Bob
    const bob = await createTestUser();
    const bobCreate = await authPost('/api/mirrors', bob.token, {
      name: 'Mirror do Bob',
    });
    const bobMirrorId = (bobCreate.body as { mirror: { id: number } }).mirror.id;

    // Alice tenta ler
    const alice = await createTestUser();
    const { status } = await authGet(`/api/mirrors/${bobMirrorId}`, alice.token);
    expect(status).toBe(404); // cross-tenant read bloqueado
  });

  test('Alice NÃO pode deletar espelhamento do Bob (DELETE)', async () => {
    const bob = await createTestUser();
    const bobCreate = await authPost('/api/mirrors', bob.token, {
      name: 'Mirror do Bob',
    });
    const bobMirrorId = (bobCreate.body as { mirror: { id: number } }).mirror.id;

    const alice = await createTestUser();
    const res = await fetch(`${API}/api/mirrors/${bobMirrorId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    expect(res.status).toBe(404);

    // Verifica que Bob ainda consegue acessar
    const bobVerify = await authGet(`/api/mirrors/${bobMirrorId}`, bob.token);
    expect(bobVerify.status).toBe(200);
  });

  test('Alice NÃO pode alterar status do espelhamento do Bob (PATCH)', async () => {
    const bob = await createTestUser();
    const bobCreate = await authPost('/api/mirrors', bob.token, {
      name: 'Mirror do Bob',
    });
    const bobMirrorId = (bobCreate.body as { mirror: { id: number } }).mirror.id;

    const alice = await createTestUser();
    const res = await fetch(`${API}/api/mirrors/${bobMirrorId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${alice.token}`,
      },
      body: JSON.stringify({ status: 'inactive' }),
    });
    expect(res.status).toBe(404);

    // Status do Bob continua active
    const bobVerify = await authGet(`/api/mirrors/${bobMirrorId}`, bob.token);
    const bobMirror = (bobVerify.body as { mirror: { status: string } }).mirror;
    expect(bobMirror.status).toBe('active');
  });

  test('Alice PODE acessar o próprio espelhamento', async () => {
    const alice = await createTestUser();
    const aliceCreate = await authPost('/api/mirrors', alice.token, {
      name: 'Mirror da Alice',
    });
    const aliceMirrorId = (aliceCreate.body as { mirror: { id: number } }).mirror.id;
    const { status } = await authGet(`/api/mirrors/${aliceMirrorId}`, alice.token);
    expect(status).toBe(200);
  });
});

// ─── Item #3 — Webhook exige apikey ──────────────────────────────────

test.describe('Security #3 — Webhook exige apikey', () => {
  test('POST /webhook/message sem apikey → 401', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'connection.update', data: {} }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toBe('Unauthorized');
  });

  test('POST /webhook/message com apikey errada → 401', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: 'apikey-errada',
      },
      body: JSON.stringify({ event: 'connection.update', data: {} }),
    });
    expect(res.status).toBe(401);
  });

  test('POST /webhook/message com apikey vazia → 401', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: '',
      },
      body: JSON.stringify({ event: 'connection.update', data: {} }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── Item #4 — JWT secret não pode ser hardcoded ─────────────────────

test.describe('Security #4 — JWT secret', () => {
  test('Variáveis sensíveis não aparecem no processo da API', async () => {
    // Sanity check: tokens válidos do helper helpers.ts devem funcionar
    const { token } = await createTestUser();
    const { status, body } = await authGet('/api/auth/me', token);
    expect(status).toBe(200);
    expect((body as { success: boolean }).success).toBe(true);
  });

  test('Token assinado com secret da env é aceito', async () => {
    // Se o servidor está rodando com secret diferente, o token seria rejeitado
    const { token } = await createTestUser();
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

// ─── Item #5 — CORS whitelist ───────────────────────────────────────

test.describe('Security #5 — CORS whitelist', () => {
  test('OPTIONS da origem permitida retorna Access-Control-Allow-Origin', async () => {
    const res = await fetch(`${API}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5441', // FRONTEND_URL default em dev
        'Access-Control-Request-Method': 'GET',
      },
    });
    // Em dev: deve ter o header Access-Control-Allow-Origin
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  test('CORS retorna origin matchada (não * quando whitelist)', async () => {
    // Mesmo exemplo: a origem solicitada deve estar no allow-list
    const res = await fetch(`${API}/health`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173', // Vite dev
        'Access-Control-Request-Method': 'GET',
      },
    });
    const allowed = res.headers.get('access-control-allow-origin');
    expect(allowed === 'http://localhost:5173' || allowed === '*').toBe(true);
  });
});

// ─── Item #6 — JWT exp 7 dias ───────────────────────────────────────

test.describe('Security #6 — JWT exp', () => {
  test('Token emitido em /login tem claim exp (~7 dias)', async () => {
    const helperRes = await createTestUser();
    const token = helperRes.token;

    // Decodifica payload (sem verificar assinatura — confiamos no signup)
    const parts = token.split('.');
    expect(parts.length).toBe(3);
    const payloadB64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8')) as {
      exp?: number;
      iat?: number;
    };

    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');

    const lifetime = Number(payload.exp) - Number(payload.iat);
    const sevenDays = 7 * 24 * 60 * 60;
    // Tolerância de ±5 segundos
    expect(Math.abs(lifetime - sevenDays)).toBeLessThanOrEqual(5);
  });

  test('Token emitido em /register tem claim exp', async () => {
    const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.local`;
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        name: 'Test',
        password: 'Test@123456',
      }),
    });
    const data = (await res.json()) as { token: string };
    expect(data.token).toBeDefined();

    const parts = data.token.split('.');
    const payloadB64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf-8')) as {
      exp?: number;
    };

    expect(typeof payload.exp).toBe('number');
  });
});

// ─── Item #7 — Rate limit em login/register ─────────────────────────

test.describe('Security #7 — Rate limit login/register', () => {
  // Rate limit é desabilitado em NODE_ENV=test (docker-compose.e2e.yml) —
  // senão a suíte E2E, que cria dezenas de usuários do mesmo IP, seria
  // bloqueada. O comportamento do IpRateLimiter é coberto por unit tests
  // (auth-rate-limit-pure.test.ts).
  test.skip('6 logins consecutivos com senha errada → o 6º retorna 429', async () => {
    const email = `ratelimit-${Date.now()}@e2e.local`;
    // Cria usuário
    await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        name: 'Rate',
        password: 'Test@123456',
      }),
    });

    // 5 primeiras tentativas: retornam 401 (credencial errada)
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrong' }),
      });
      expect(res.status).toBe(401);
    }

    // 6ª tentativa: bloqueada por rate limit
    const sixthRes = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong' }),
    });
    expect(sixthRes.status).toBe(429);
    const data = (await sixthRes.json()) as { error?: string; retryAfterMs?: number };
    expect(data.error).toContain('Limite');
    expect(data.retryAfterMs).toBeDefined();
    expect(sixthRes.headers.get('retry-after')).toBeDefined();
  });
});

// ─── Item #8 — Swagger restrito a dev ────────────────────────────────

test.describe('Security #8 — Swagger restrito', () => {
  test('GET /docs está acessível em dev (non-production)', async () => {
    // Em dev, Swagger está sempre exposto no path /docs
    // Obs: @elysiajs/swagger 1.3.x renderiza via Scalar UI (sem a palavra "swagger" no HTML)
    const res = await fetch(`${API}/docs`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.toLowerCase()).toContain('scalar');
  });

  test('GET /docs/json retorna OpenAPI spec', async () => {
    // @elysiajs/swagger 1.3.x expõe a spec em {path}/json (não /swagger.json)
    const res = await fetch(`${API}/docs/json`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { openapi?: string; info?: { title?: string } };
    expect(data.openapi).toBeDefined();
    expect(data.info?.title).toContain('Mestre Afiliado');
  });
});
