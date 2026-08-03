/**
 * E2E de UI — integração Amazon com um único Tracking ID.
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { uniqueEmail, TEST_NAME, TEST_PASSWORD } from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;
const TRACKING_ID = 'meusite-whatsapp-20';

async function registerAndOpenAmazon(page: Page): Promise<void> {
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: uniqueEmail(),
      name: TEST_NAME,
      password: TEST_PASSWORD,
    }),
  });
  const data = (await res.json()) as { token: string };

  await page.goto('/');
  await page.evaluate((token: string) => {
    localStorage.setItem('omestre_auth_token', token);
  }, data.token);
  await page.goto('/settings');
  await page.reload();
  await page.getByRole('tab', { name: 'Amazon' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Amazon' })).toBeVisible();
}

test.describe('UI — integração Amazon', () => {
  // EXPERIMENTO workers=2: spawn UNKNOWN ao subir 2º Chromium em paralelo (limitação local). Validar depois.
  test.skip('exibe somente o cadastro de um Tracking ID', async ({ page }) => {
    await registerAndOpenAmazon(page);

    const panel = page.getByRole('tabpanel', { name: 'Amazon' });
    await expect(panel.getByText('Não configurado')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Tracking ID' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Salvar' })).toBeVisible();

    await expect(panel.getByText(/Apelido/)).toHaveCount(0);
    await expect(panel.getByText(/Região/)).toHaveCount(0);
    await expect(panel.getByText(/Tracking IDs \(/)).toHaveCount(0);
  });

  test('salva e exibe um único Tracking ID', async ({ page }) => {
    await registerAndOpenAmazon(page);

    const panel = page.getByRole('tabpanel', { name: 'Amazon' });
    await panel.getByRole('textbox', { name: 'Tracking ID' }).fill(TRACKING_ID);
    await panel.getByRole('button', { name: 'Salvar' }).click();

    await expect(panel.getByText('Configurado', { exact: true })).toBeVisible();
    await expect(panel.getByText('Tracking ID ativo')).toBeVisible();
    await expect(panel.getByText(TRACKING_ID)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Remover' })).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Tracking ID' })).toHaveCount(0);
  });

  test('remove o Tracking ID e volta ao estado não configurado', async ({ page }) => {
    await registerAndOpenAmazon(page);

    const panel = page.getByRole('tabpanel', { name: 'Amazon' });
    await panel.getByRole('textbox', { name: 'Tracking ID' }).fill(TRACKING_ID);
    await panel.getByRole('button', { name: 'Salvar' }).click();
    await expect(panel.getByRole('button', { name: 'Remover' })).toBeVisible();

    page.once('dialog', (dialog) => dialog.accept());
    await panel.getByRole('button', { name: 'Remover' }).click();

    await expect(panel.getByText('Não configurado')).toBeVisible();
    await expect(panel.getByRole('textbox', { name: 'Tracking ID' })).toBeVisible();
    await expect(panel.getByText(TRACKING_ID)).toHaveCount(0);
  });
});
