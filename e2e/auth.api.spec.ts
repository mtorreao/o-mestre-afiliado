/**
 * Testes E2E de API — Fluxo de autenticação e cadastro de afiliado.
 *
 * Requer: API rodando em http://localhost:5442
 */

import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  TEST_PASSWORD,
  TEST_NAME,
  createTestUser,
  authGet,
  authPost,
  authPut,
} from './helpers.ts';

const API = process.env.API_URL || 'http://localhost:5446';

// ─── Setup: limpar dados de testes anteriores ───────────────────────────

// ─── Register ────────────────────────────────────────────────────────────

test.describe('Auth - Register', () => {
  test('deve registrar um novo usuário com sucesso', async () => {
    const email = uniqueEmail();
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect(body.user).toBeDefined();
    expect((body.user as Record<string, unknown>).email).toBe(email);
  });

  test('deve rejeitar email duplicado', async () => {
    const email = uniqueEmail();
    // Primeiro registro
    await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });

    // Segundo registro com mesmo email
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: 'Outro', password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Email já cadastrado');
  });

  test('deve rejeitar senha curta', async () => {
    const res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail(),
        name: TEST_NAME,
        password: '123',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  test('deve rejeitar campos faltando', async () => {
    let res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: TEST_NAME, password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(400);

    res = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail(), password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Login ───────────────────────────────────────────────────────────────

test.describe('Auth - Login', () => {
  let email: string;

  test.beforeEach(async () => {
    email = uniqueEmail();
    await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });
  });

  test('deve fazer login com credenciais válidas', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect(body.token).toBeDefined();
    expect((body.user as Record<string, unknown>).email).toBe(email);
  });

  test('deve rejeitar senha incorreta', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  test('deve rejeitar email inexistente', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'naoexiste@teste.com', password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /me ─────────────────────────────────────────────────────────────

test.describe('Auth - GET /me', () => {
  test('deve retornar dados do usuário autenticado', async () => {
    const { token } = await createTestUser();
    const { status, body } = await authGet('/api/auth/me', token);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect((body.user as Record<string, unknown>).email).toBeDefined();
  });

  test('deve rejeitar requisição sem token', async () => {
    const res = await fetch(`${API}/api/auth/me`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Não autenticado');
  });

  test('deve rejeitar token inválido', async () => {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });
});

// ─── Profile ─────────────────────────────────────────────────────────────

test.describe('Affiliate - Profile', () => {
  test('deve retornar perfil vazio para novo usuário', async () => {
    const { token } = await createTestUser();
    const { status, body } = await authGet('/api/affiliate/profile', token);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const profile = body.profile as Record<string, unknown>;
    expect(profile.shopeeConfigured).toBe(false);
    expect(profile.shopeeAppId).toBeNull();
  });

  test('deve atualizar credenciais Shopee', async () => {
    const { token } = await createTestUser();

    const { status } = await authPut('/api/affiliate/profile', token, {
      shopeeAppId: 'app123',
      shopeeAppSecret: 'secret456',
    });
    expect(status).toBe(200);

    // Verificar
    const { body } = await authGet('/api/affiliate/profile', token);
    const profile = body.profile as Record<string, unknown>;
    expect(profile.shopeeConfigured).toBe(true);
    expect(profile.shopeeAppId).toBe('app123');
  });

  test('deve rejeitar perfil sem autenticação', async () => {
    const res = await fetch(`${API}/api/affiliate/profile`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  test('deve permitir salvar credenciais vazias', async () => {
    const { token } = await createTestUser();
    const { status } = await authPut('/api/affiliate/profile', token, {});
    expect(status).toBe(200);
  });
});

// ─── Test Conversion ─────────────────────────────────────────────────────

test.describe('Affiliate - Test Conversion', () => {
  test('deve rejeitar conversão sem credenciais Shopee', async () => {
    const { token } = await createTestUser();
    const { status, body } = await authPost(
      '/api/affiliate/test-conversion',
      token,
      { url: 'https://shopee.com.br/product/123' },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect((body.error as string) || '').toContain('Credenciais');
  });

  test('deve rejeitar conversão ML sem conta vinculada', async () => {
    const { token } = await createTestUser();
    const { status, body } = await authPost(
      '/api/affiliate/test-conversion',
      token,
      { url: 'https://www.mercadolivre.com.br/product/123' },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect((body.error as string) || '').toContain('Mercado Livre');
  });

  test('deve rejeitar URL de marketplace não suportado', async () => {
    const { token } = await createTestUser();
    const { status } = await authPost(
      '/api/affiliate/test-conversion',
      token,
      { url: 'https://amazon.com.br/product/123' },
    );
    expect(status).toBe(400);
  });

  test('deve rejeitar URL vazia', async () => {
    const { token } = await createTestUser();
    const { status } = await authPost(
      '/api/affiliate/test-conversion',
      token,
      { url: '' },
    );
    expect(status).toBe(400);
  });
});
