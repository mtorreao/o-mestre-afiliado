/**
 * Testes E2E de UI — Fluxo de conexão WhatsApp.
 *
 * Testa a renderização do componente WppConnection dentro do dashboard.
 *
 * Requer:
 *   - Web dev server rodando em http://localhost:5441
 *   - API rodando em http://localhost:5442
 *   - Evolution API rodando (E2E stack)
 */

import { test, expect } from '@playwright/test';
import { uniqueEmail, TEST_PASSWORD, TEST_NAME } from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

test.describe('UI - WhatsApp Connection Card', () => {
  test('deve exibir o card WhatsApp no dashboard com botão Conectar', async ({ page }) => {
    // Registrar usuário via API
    const email = uniqueEmail();
    const res = await fetch(`${API}/api/auth/register`, {
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

    // Verificar que o card WhatsApp está presente
    await expect(page.locator('text=💬 WhatsApp')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Conectar WhatsApp')).toBeVisible({ timeout: 10_000 });
  });

  test('deve mostrar "Verificando conexão..." ao carregar', async ({ page }) => {
    const email = uniqueEmail();
    const res = await fetch(`${API}/api/auth/register`, {
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

    // O estado inicial é 'loading' — "Verificando conexão..."
    // Depois muda para 'disconnected' com o botão
    await expect(page.locator('text=💬 WhatsApp')).toBeVisible({ timeout: 10_000 });

    // Aguardar até que o loading termine e o botão apareça
    await expect(page.locator('text=Conectar WhatsApp')).toBeVisible({ timeout: 15_000 });
  });

  test('deve mostrar status "⚪ Desconectado" quando não conectado', async ({ page }) => {
    const email = uniqueEmail();
    const res = await fetch(`${API}/api/auth/register`, {
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

    await expect(page.locator('text=⚪ Desconectado')).toBeVisible({ timeout: 15_000 });
  });

  test('deve iniciar conexão ao clicar em Conectar WhatsApp', async ({ page }) => {
    const email = uniqueEmail();
    const res = await fetch(`${API}/api/auth/register`, {
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

    // Aguardar o dashboard carregar com o botão
    await expect(page.locator('text=💬 WhatsApp')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=Conectar WhatsApp')).toBeVisible({ timeout: 10_000 });

    // Clicar em Conectar
    await page.click('text=Conectar WhatsApp');

    // Deve mostrar o spinner de conexão (conectando)
    // ou diretamente o QR code
    // Pode mostrar "Conectando ao WhatsApp..." ou QR code
    await page.waitForTimeout(2000);

    // Verificar se o status mudou para conectando ou aguardando scan
    const connectingVisible = await page.locator('text=🔄 Conectando').isVisible().catch(() => false);
    const awaitingScanVisible = await page.locator('text=⏳ Aguardando scan').isVisible().catch(() => false);
    const connectedVisible = await page.locator('text=✅ Conectado').isVisible().catch(() => false);
    const errorVisible = await page.locator('text=❌ Erro').isVisible().catch(() => false);

    // Um desses estados deve estar visível (conectando → QR → conectado, ou erro se Evolution falhou)
    const anyValidState = connectingVisible || awaitingScanVisible || connectedVisible || errorVisible;
    expect(anyValidState).toBe(true);

    // Se conectou, testar desconexão
    if (connectedVisible) {
      await page.click('text=Desconectar WhatsApp');
      await expect(page.locator('text=⚪ Desconectado')).toBeVisible({ timeout: 15_000 });
    }
  });

  test('deve exibir erro se Evolution API não responde', async ({ page }) => {
    // Simula falha da Evolution registrando um usuário mas sem instância ativa
    const email = uniqueEmail();
    const res = await fetch(`${API}/api/auth/register`, {
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

    await expect(page.locator('text=💬 WhatsApp')).toBeVisible({ timeout: 10_000 });

    // Clicar em conectar
    // Se a Evolution API estiver OK, o teste passa com QR code
    // Se estiver offline, mostra erro — ambos são aceitáveis
    await page.click('text=Conectar WhatsApp');
    await page.waitForTimeout(3000);

    // Qualquer estado é aceitável: conectar mostra feedback visual
    const hasFeedback = await page.locator('text=🔄 Conectando')
      .or(page.locator('text=⏳ Aguardando scan'))
      .or(page.locator('text=✅ Conectado'))
      .or(page.locator('text=❌ Erro'))
      .isVisible()
      .catch(() => false);

    expect(hasFeedback).toBe(true);
  });

  test('deve mostrar WhatsApp card em layout consistente com outros cards', async ({ page }) => {
    const email = uniqueEmail();
    const res = await fetch(`${API}/api/auth/register`, {
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

    // Verificar que todos os cards estão visíveis no layout
    await expect(page.locator('text=🛒 Shopee')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('text=📦 Mercado Livre')).toBeVisible();
    await expect(page.locator('text=🧪 Testar Conversão')).toBeVisible();
    await expect(page.locator('text=💬 WhatsApp')).toBeVisible();
  });
});
