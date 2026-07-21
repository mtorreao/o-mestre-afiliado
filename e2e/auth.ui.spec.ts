/**
 * Testes E2E de UI — Fluxo de autenticação e dashboard.
 *
 * Requer:
 *   - Web dev server rodando em http://localhost:5441
 *   - API rodando em http://localhost:5442
 */

import { test, expect } from '@playwright/test';
import { uniqueEmail, TEST_PASSWORD, TEST_NAME } from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

function apiUrl(path: string) {
  return `${API}${path}`;
}

test.describe('UI - Login Page', () => {
  test('deve exibir o formulário de login', async ({ page }) => {
    await page.goto('/');

    // Verificar elementos principais
    await expect(page.locator('h1')).toContainText('O Mestre Afiliado');
    await expect(page.locator('text=Faça login para continuar')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button:has-text("Entrar")')).toBeVisible();
    await expect(page.locator('text=Criar conta')).toBeVisible();
  });

  test('deve mostrar erro para credenciais inválidas', async ({ page }) => {
    await page.goto('/');

    await page.fill('input[type="email"]', 'errado@teste.com');
    await page.fill('input[type="password"]', 'senha-errada');
    await page.click('button:has-text("Entrar")');

    // Aguardar resposta do servidor
    await expect(page.locator('text=Email ou senha inválidos')).toBeVisible({ timeout: 10_000 });
  });

  test('deve permitir navegar para tela de registro', async ({ page }) => {
    await page.goto('/');

    await page.click('text=Criar conta');

    // Deve estar na tela de registro
    await expect(page.locator('h1')).toContainText('Criar Conta');
    await expect(page.locator('input[placeholder="Seu nome"]')).toBeVisible();
  });
});

test.describe('UI - Register Page', () => {
  test('deve registrar novo usuário e mostrar dashboard', async ({ page }) => {
    const email = uniqueEmail();

    // Navegar para registro clicando no link da tela de login
    await page.goto('/');
    await page.waitForSelector('text=Criar conta');
    await page.click('text=Criar conta');

    await page.waitForSelector('h1:has-text("Criar Conta")');

    // Preencher formulário
    await page.fill('input[placeholder="Seu nome"]', TEST_NAME);
    await page.fill('input[type="email"]', email);
    // São 2 inputs password: senha + confirmar
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(TEST_PASSWORD);
    await passwordInputs.nth(1).fill(TEST_PASSWORD);

    // Clicar em "Criar Conta"
    await page.click('button:has-text("Criar Conta")');

    // Aguardar redirecionamento para o dashboard
    await expect(page.locator('text=Olá,')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`text=${TEST_NAME}`)).toBeVisible();
  });

  test('deve mostrar erro para email duplicado', async ({ page }) => {
    const email = uniqueEmail();

    // Criar usuário via API primeiro
    await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });

    // Tentar registrar novamente pelo UI
    await page.goto('/');
    await page.click('text=Criar conta');
    await page.waitForSelector('h1:has-text("Criar Conta")');

    await page.fill('input[placeholder="Seu nome"]', TEST_NAME);
    await page.fill('input[type="email"]', email);
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill(TEST_PASSWORD);
    await passwordInputs.nth(1).fill(TEST_PASSWORD);
    await page.click('button:has-text("Criar Conta")');

    await expect(page.locator('text=Email já cadastrado')).toBeVisible({ timeout: 10_000 });
  });

  test('deve validar senhas diferentes', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Criar conta');
    await page.waitForSelector('h1:has-text("Criar Conta")');

    await page.fill('input[placeholder="Seu nome"]', TEST_NAME);
    await page.fill('input[type="email"]', uniqueEmail());
    const passwordInputs = page.locator('input[type="password"]');
    await passwordInputs.nth(0).fill('123456');
    await passwordInputs.nth(1).fill('654321');
    await page.click('button:has-text("Criar Conta")');

    await expect(page.locator('text=Senhas não conferem')).toBeVisible();
  });
});

test.describe('UI - Dashboard', () => {
  test('deve exibir seções do dashboard após login', async ({ page, context }) => {
    // Registrar usuário via API
    const email = uniqueEmail();
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });
    const data = (await res.json()) as { token: string };
    const token = data.token;

    // Injetar token no localStorage antes de navegar
    await page.goto('/');
    await page.evaluate(
      (t: string) => localStorage.setItem('omestre_auth_token', t),
      token,
    );

    // Recarregar — agora deve estar autenticado
    await page.reload();

    // Deve mostrar o dashboard com as seções
    await expect(page.locator('text=Olá,')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=O Mestre Afiliado')).toBeVisible();

    // Seções do dashboard
    await expect(page.locator('text=🛒 Shopee')).toBeVisible();
    await expect(page.locator('text=📦 Mercado Livre')).toBeVisible();
    await expect(page.locator('text=🧪 Testar Conversão')).toBeVisible();
    await expect(page.locator('text=Sair')).toBeVisible();
  });

  test('deve atualizar credenciais Shopee e verificar', async ({ page }) => {
    // Registrar via API
    const email = uniqueEmail();
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });
    const data = (await res.json()) as { token: string };

    // Autenticar via localStorage
    await page.goto('/');
    await page.evaluate(
      (t: string) => localStorage.setItem('omestre_auth_token', t),
      data.token,
    );
    await page.reload();
    await page.waitForSelector('text=🛒 Shopee');

    // Preencher credenciais Shopee pelos placeholders
    const appIdInput = page.locator('input[placeholder="Seu App ID da Shopee"]');
    const secretInput = page.locator('input[placeholder="Seu App Secret da Shopee"]');
    await appIdInput.fill('e2e-app-id');
    await secretInput.fill('e2e-app-secret');

    // Clicar em Salvar
    await page.click('button:has-text("Salvar")');

    // Aguardar confirmação
    await expect(page.locator('text=✅ Salvo!')).toBeVisible({ timeout: 10_000 });
  });

  test('deve testar conversão com URL inválida', async ({ page }) => {
    // Autenticar
    const email = uniqueEmail();
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });
    const data = (await res.json()) as { token: string };

    await page.goto('/');
    await page.evaluate(
      (t: string) => localStorage.setItem('omestre_auth_token', t),
      data.token,
    );
    await page.reload();
    await page.waitForSelector('text=🧪 Testar Conversão');

    // Preencher URL e testar
    const testInput = page.locator('input[placeholder="Cole a URL do produto (Shopee ou ML)..."]');
    await testInput.fill('https://shopee.com.br/product/123');

    await page.click('button:has-text("Testar")');

    // Deve mostrar erro de credenciais não configuradas
    await expect(page.locator('text=Credenciais')).toBeVisible({ timeout: 10_000 });
  });

  test('deve fazer logout', async ({ page }) => {
    // Autenticar
    const email = uniqueEmail();
    const res = await fetch(apiUrl('/api/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
    });
    const data = (await res.json()) as { token: string };

    await page.goto('/');
    await page.evaluate(
      (t: string) => localStorage.setItem('omestre_auth_token', t),
      data.token,
    );
    await page.reload();
    await page.waitForSelector('text=Sair');

    // Clicar em Sair
    await page.click('text=Sair');

    // Deve voltar para tela de login
    await expect(page.locator('text=Faça login para continuar')).toBeVisible({ timeout: 10_000 });
  });
});
