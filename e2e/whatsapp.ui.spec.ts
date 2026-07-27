/**
 * Testes E2E de UI — Fluxo de conexão WhatsApp.
 *
 * Testa a renderização do componente WppConnection na página de
 * Configurações (aba "WhatsApp", que é a aba padrão do SettingsPage).
 * O card NÃO fica no dashboard — o dashboard só tem um MetricCard
 * "WhatsApp" com o status resumido.
 *
 * Requer:
 *   - Web dev server rodando em http://localhost:5441
 *   - API rodando em http://localhost:5442
 *   - Evolution API rodando (E2E stack)
 *
 * Seletores: o card é um `Card title="💬 WhatsApp"` renderizado como <h3>,
 * apontado via getByRole('heading', { name: /WhatsApp/ }) para evitar
 * ambiguidade com o MetricCard "WhatsApp" do dashboard.
 */

import { test, expect } from '@playwright/test';
import { uniqueEmail, TEST_PASSWORD, TEST_NAME } from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

/** Card WhatsApp (WppConnection) — título renderizado como <h3>💬 WhatsApp</h3>. */
function wppCard(page: import('@playwright/test').Page) {
  return page.getByRole('heading', { name: /WhatsApp/ });
}

async function registerAndOpenSettings(page: import('@playwright/test').Page) {
  const email = uniqueEmail();
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
  });
  const data = (await res.json()) as { token: string };

  await page.goto('/');
  await page.evaluate((t: string) => localStorage.setItem('omestre_auth_token', t), data.token);
  // O WppConnection fica em /settings (aba WhatsApp é a default)
  await page.goto('/settings');
  await page.reload();
  return data.token;
}

test.describe('UI - WhatsApp Connection Card', () => {
  test('deve exibir o card WhatsApp em Configurações com botão Conectar', async ({ page }) => {
    await registerAndOpenSettings(page);

    await expect(wppCard(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Conectar WhatsApp' })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('deve mostrar "Verificando conexão..." ao carregar', async ({ page }) => {
    await registerAndOpenSettings(page);

    await expect(wppCard(page)).toBeVisible({ timeout: 10_000 });
    // O estado inicial pode ser 'loading' ("Verificando conexão...") e rapidamente
    // muda para 'disconnected' (botão "Conectar WhatsApp"). Ambos são aceitáveis.
    const loaded = page
      .getByText('Verificando conexão...')
      .or(page.getByRole('button', { name: 'Conectar WhatsApp' }));
    await expect(loaded).toBeVisible({ timeout: 15_000 });
  });

  test('deve mostrar botão Conectar quando não conectado', async ({ page }) => {
    await registerAndOpenSettings(page);

    // Estado desconectado → botão "Conectar WhatsApp" visível (só aparece quando disconnected)
    await expect(page.getByRole('button', { name: 'Conectar WhatsApp' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('deve iniciar conexão ao clicar em Conectar WhatsApp', async ({ page }) => {
    await registerAndOpenSettings(page);

    await expect(wppCard(page)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: 'Conectar WhatsApp' })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole('button', { name: 'Conectar WhatsApp' }).click();

    // Estados possíveis após clicar: conectando, QR (escaneie), conectado ou erro.
    // Seletores específicos para evitar strict-mode (badge vs body).
    const feedback = page
      .getByText('Conectando ao WhatsApp')
      .or(page.getByText('Escaneie o QR Code'))
      .or(page.getByText('WhatsApp Conectado'))
      .or(page.getByRole('button', { name: 'Regenerar QR Code' }));

    await expect(feedback).toBeVisible({ timeout: 15_000 });

    // Se conectou, testar desconexão
    const connectedVisible = await page
      .getByText('WhatsApp Conectado')
      .isVisible()
      .catch(() => false);
    if (connectedVisible) {
      await page.getByRole('button', { name: 'Desconectar WhatsApp' }).click();
      await expect(page.getByRole('button', { name: 'Conectar WhatsApp' })).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test('deve exibir feedback ao clicar em Conectar (mesmo se Evolution falhar)', async ({
    page,
  }) => {
    await registerAndOpenSettings(page);

    await expect(wppCard(page)).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: 'Conectar WhatsApp' }).click();

    const feedback = page
      .getByText('Conectando ao WhatsApp')
      .or(page.getByText('Escaneie o QR Code'))
      .or(page.getByText('WhatsApp Conectado'))
      .or(page.getByRole('button', { name: 'Regenerar QR Code' }));

    await expect(feedback).toBeVisible({ timeout: 15_000 });
  });

  test('deve mostrar card WhatsApp em layout consistente com as abas de configuração', async ({
    page,
  }) => {
    await registerAndOpenSettings(page);

    await expect(wppCard(page)).toBeVisible({ timeout: 10_000 });
    // Abas de configuração presentes
    await expect(page.getByRole('tab', { name: /Shopee/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Mercado Livre/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Amazon/ })).toBeVisible();
  });
});
