/**
 * Validação visual — sub-rate limit do espelhamento está OCULTO.
 *
 * Após o commit fix(web): ocultar form de sub-rate limit do espelhamento,
 * os seguintes elementos NÃO devem aparecer:
 *   - Card "⚠️ Limites de Envio (Rate Limit)" em /mirror-form
 *   - Card "📊 Limite por Grupo de Destino" em /mirror-form
 *   - Inputs "Máx. mensagens por janela" e "Janela (segundos)"
 *   - Chip "Limite: …" na expansão inline de um espelho em /mirrors
 *
 * Screenshots salvos em e2e/screenshots/validate-mirror-rate-limit-hidden/.
 */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { uniqueEmail, TEST_PASSWORD, TEST_NAME } from '../../helpers/index.ts';

const WEB = process.env.WEB_URL || `http://localhost:${process.env.WEB_PORT || '15441'}`;
const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;
// API mirror (15447) aponta para o simulador — grupos admin válidos.
const API_MIRROR =
  process.env.API_MIRROR_URL || `http://localhost:${process.env.API_MIRROR_PORT || '15447'}`;

// Playwright roda com cwd na raiz do repo. Os screenshots vão para
// e2e/screenshots/validate-mirror-rate-limit-hidden/.
const SHOTS_DIR = resolve('e2e/screenshots/validate-mirror-rate-limit-hidden');
mkdirSync(SHOTS_DIR, { recursive: true });

const shotPath = (name: string) => resolve(SHOTS_DIR, name);

async function loginDirect(page: Page): Promise<string> {
  const email = uniqueEmail();
  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: TEST_NAME, password: TEST_PASSWORD }),
  });
  const data = (await res.json()) as { success: boolean; token: string };
  const { token } = data;

  await page.goto(`${WEB}/`);
  await page.evaluate((t: string) => {
    localStorage.setItem('omestre_auth_token', t);
  }, token);
  await page.goto(`${WEB}/`);
  await page.waitForSelector('text=Atalhos Rápidos', { timeout: 15_000 });
  return token;
}

async function createMirror(token: string, name: string) {
  // Conecta WhatsApp no simulador e cria via API mirror (validação de admin).
  await fetch(`${API_MIRROR}/api/whatsapp/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '{}',
  });
  await fetch(`${API_MIRROR}/api/mirrors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name,
      sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
      targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
    }),
  });
}

test.describe('Validação: sub-rate limit do espelhamento oculto', () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    token = await loginDirect(page);
  });

  test('Form de criação não exibe os cards de rate limit', async ({ page }) => {
    await page.click('button:has-text("Espelhamentos")');
    await page.waitForSelector('text=📋 Espelhamentos');

    await page.locator('button:has-text("Novo")').first().click();
    await page.waitForURL('**/mirror-form');
    await page.waitForSelector('text=Novo Espelhamento', { timeout: 10_000 });
    await page.waitForTimeout(500);

    // Cards e inputs que devem estar AUSENTES
    await expect(page.locator('text=⚠️ Limites de Envio (Rate Limit)')).toHaveCount(0);
    await expect(page.locator('text=📊 Limite por Grupo de Destino')).toHaveCount(0);
    await expect(page.locator('text=Máx. mensagens por janela')).toHaveCount(0);
    await expect(page.locator('label:has-text("Janela (segundos)")')).toHaveCount(0);

    // Garantia que o form ainda tem o resto (nome, grupos origem/destino)
    await expect(page.locator('text=Nome do Espelhamento')).toBeVisible();
    await expect(page.locator('text=Grupos de Origem')).toBeVisible();
    await expect(page.locator('text=Grupos de Destino')).toBeVisible();

    await page.screenshot({
      path: shotPath('01-mirror-form-create.png'),
      fullPage: true,
    });
  });

  test('Form de edição não exibe os cards de rate limit', async ({ page }) => {
    await createMirror(token, 'Editar Rate');

    await page.click('button:has-text("Espelhamentos")');
    await page.waitForSelector('text=📋 Espelhamentos');
    await page.locator('button[title="Editar"]').first().click();
    await page.waitForURL('**/mirror-form/**');
    await page.waitForSelector('text=Editar Espelhamento', { timeout: 10_000 });
    await page.waitForTimeout(500);

    await expect(page.locator('text=⚠️ Limites de Envio (Rate Limit)')).toHaveCount(0);
    await expect(page.locator('text=📊 Limite por Grupo de Destino')).toHaveCount(0);
    await expect(page.locator('text=Máx. mensagens por janela')).toHaveCount(0);
    await expect(page.locator('label:has-text("Janela (segundos)")')).toHaveCount(0);

    await page.screenshot({
      path: shotPath('02-mirror-form-edit.png'),
      fullPage: true,
    });
  });

  test('Lista de espelhamentos NÃO mostra chip "Limite:" na expansão', async ({ page }) => {
    await createMirror(token, 'Sem Limite');

    await page.click('button:has-text("Espelhamentos")');
    await page.waitForSelector('text=📋 Espelhamentos');
    await page.locator('text=Sem Limite').click();
    await page.waitForTimeout(500);

    // O chip "Limite:" não deve aparecer (renderização condicional comentada).
    await expect(page.locator('span:has-text("Limite:")')).toHaveCount(0);

    await page.screenshot({
      path: shotPath('03-mirrors-list-expanded.png'),
      fullPage: true,
    });
  });
});
