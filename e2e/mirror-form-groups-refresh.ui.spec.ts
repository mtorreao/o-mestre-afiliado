/**
 * Testes E2E de UI — MirrorFormPage: avatar no dropdown, JID removido e
 * botão "Atualizar grupos" no header.
 *
 * Requer: Web em http://localhost:15441 (E2E) ou 5451 (dev), API em
 * http://localhost:15442 (E2E) ou 5452 (dev). Por padrão usa as portas E2E.
 */

import { test, expect, type Page } from '@playwright/test';
import { uniqueEmail, TEST_PASSWORD, TEST_NAME } from './helpers.ts';

const WEB = process.env.WEB_URL || `http://localhost:${process.env.WEB_PORT || '15441'}`;
const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

const EVIDENCE_DIR = 'test-results/grupos-autocomplete-evidence';

const MOCK_GROUPS = [
  {
    jid: '120363000000000001@g.us',
    name: 'Ofertas Premium',
    isAdmin: true,
    pictureUrl: 'https://example.com/premium.png',
  },
  {
    jid: '120363000000000002@g.us',
    name: 'Grupo VIP Compras',
    isAdmin: true,
    pictureUrl: 'https://example.com/vip.png',
  },
  {
    jid: '120363000000000003@g.us',
    name: 'Sem Foto',
    isAdmin: true,
    pictureUrl: null,
  },
  {
    jid: '120363000000000004@g.us',
    name: 'Membro Comum',
    isAdmin: false,
    pictureUrl: 'https://example.com/membro.png',
  },
];

/** Login direto via API: cria usuário e injeta token no localStorage. */
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

  return token;
}

/** Mocka /api/whatsapp/groups com a fixture de grupos (com e sem pictureUrl). */
async function mockWhatsAppGroups(page: Page) {
  await page.route('**/api/whatsapp/groups**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, groups: MOCK_GROUPS, fromCache: false }),
    });
  });
}

/** Limpa a rota mockada para permitir o teste interceptar novas chamadas. */
async function unrouteWhatsAppGroups(page: Page) {
  await page.unroute('**/api/whatsapp/groups**');
}

test.describe('MirrorFormPage — Grupos: refresh, avatar e JID', () => {
  test.beforeEach(async ({ page }) => {
    await loginDirect(page);
  });

  test('botão "Atualizar grupos" visível no header do MirrorFormPage', async ({ page }) => {
    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });

    const refreshButton = page.getByRole('button', { name: /Atualizar grupos/i });
    await expect(refreshButton).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE_DIR}/refresh-button.png` });
  });

  test('clicar em "Atualizar grupos" força fetch com ?force=true em ambos os autocompletes', async ({
    page,
  }) => {
    // Primeiro: mock que conta chamadas (primeira via mount, segunda via botão).
    const forceCalls: string[] = [];
    await page.route('**/api/whatsapp/groups**', (route, request) => {
      forceCalls.push(request.url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, groups: MOCK_GROUPS, fromCache: false }),
      });
    });

    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });
    // Aguarda o fetch inicial completar.
    await page.waitForResponse(
      (r) => r.url().includes('/api/whatsapp/groups') && r.status() === 200,
      { timeout: 5_000 },
    );
    const initialCalls = forceCalls.length;

    // Clica no botão.
    await page.getByRole('button', { name: /Atualizar grupos/i }).click();

    // Aguarda a chamada com force=true.
    await expect
      .poll(() => forceCalls.some((u) => u.includes('force=true')), { timeout: 5_000 })
      .toBe(true);

    // Deve ter havido mais chamadas após o clique.
    expect(forceCalls.length).toBeGreaterThan(initialCalls);
  });

  test('dropdown de origem exibe avatar (img ou span com inicial) e remove o JID', async ({
    page,
  }) => {
    await mockWhatsAppGroups(page);
    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });
    await page.waitForResponse(
      (r) => r.url().includes('/api/whatsapp/groups') && r.status() === 200,
      { timeout: 5_000 },
    );

    const originInput = page.locator('input[placeholder="Buscar grupo..."]');
    await originInput.click();
    // Abre o dropdown. O componente é combobox ARIA 1.2.
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 3_000 });

    // Cada option contém a imagem OU o fallback de inicial.
    const firstOption = page.getByRole('option').first();
    const html = await firstOption.innerHTML();
    // O componente renderiza <img src=...> para grupos com pictureUrl.
    // Aceita ambos os casos: img ou texto puro (inicial via span).
    expect(html).toMatch(/<img|>\w</);

    // O JID do grupo não aparece no option (era a regra original).
    expect(html).not.toContain('120363000000000001@g.us');

    await page.screenshot({ path: `${EVIDENCE_DIR}/origin-dropdown-avatar.png` });
  });

  test('dropdown de destino mostra apenas grupos admin e renderiza avatar', async ({ page }) => {
    await mockWhatsAppGroups(page);
    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });
    await page.waitForResponse(
      (r) => r.url().includes('/api/whatsapp/groups') && r.status() === 200,
      { timeout: 5_000 },
    );

    const destInput = page.locator('input[placeholder="Buscar grupo de destino..."]');
    await destInput.click();

    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible({ timeout: 3_000 });

    // Apenas 3 grupos (os 3 com isAdmin=true) devem aparecer.
    const options = page.getByRole('option');
    await expect(options).toHaveCount(3);

    // O grupo "Membro Comum" (isAdmin=false) não aparece.
    await expect(page.getByText('Membro Comum')).toHaveCount(0);

    // O grupo "Sem Foto" aparece (admin) e cai para a inicial "S".
    const semFoto = page.getByRole('option').filter({ hasText: 'Sem Foto' });
    await expect(semFoto).toBeVisible();
    const semFotoHtml = await semFoto.innerHTML();
    expect(semFotoHtml).not.toContain('<img');
    expect(semFotoHtml).toContain('>S<');

    // O grupo "Ofertas Premium" tem pictureUrl e renderiza <img>.
    const premium = page.getByRole('option').filter({ hasText: 'Ofertas Premium' });
    const premiumHtml = await premium.innerHTML();
    expect(premiumHtml).toContain('<img');
    expect(premiumHtml).toContain('https://example.com/premium.png');

    await page.screenshot({ path: `${EVIDENCE_DIR}/dest-dropdown-avatar.png` });
  });

  test('tags de origem mostram avatar + nome, sem JID', async ({ page }) => {
    await mockWhatsAppGroups(page);
    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });
    await page.waitForResponse(
      (r) => r.url().includes('/api/whatsapp/groups') && r.status() === 200,
      { timeout: 5_000 },
    );

    const originInput = page.locator('input[placeholder="Buscar grupo..."]');
    await originInput.click();
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 3_000 });
    await page.getByRole('option').filter({ hasText: 'Ofertas Premium' }).first().click();

    // Após selecionar, a tag renderiza avatar + nome.
    await expect(page.locator('text=Ofertas Premium').first()).toBeVisible();
    // O JID não aparece em lugar nenhum da UI.
    const jidVisible = await page.locator('text=120363000000000001@g.us').count();
    expect(jidVisible).toBe(0);
    // A foto do grupo aparece na tag como <img>.
    await expect(page.locator('img[src="https://example.com/premium.png"]').first()).toBeVisible();
  });

  test('tags de destino mostram avatar + nome, sem JID', async ({ page }) => {
    await mockWhatsAppGroups(page);
    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });
    await page.waitForResponse(
      (r) => r.url().includes('/api/whatsapp/groups') && r.status() === 200,
      { timeout: 5_000 },
    );

    const destInput = page.locator('input[placeholder="Buscar grupo de destino..."]');
    await destInput.click();
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 3_000 });
    await page.getByRole('option').filter({ hasText: 'Grupo VIP Compras' }).first().click();

    // O nome aparece na tag.
    await expect(page.locator('text=Grupo VIP Compras').first()).toBeVisible();
    // O JID não aparece em lugar nenhum da UI.
    const jidVisible = await page.locator('text=120363000000000002@g.us').count();
    expect(jidVisible).toBe(0);
    // A foto do grupo aparece na tag como <img>.
    await expect(page.locator('img[src="https://example.com/vip.png"]').first()).toBeVisible();
  });
});
