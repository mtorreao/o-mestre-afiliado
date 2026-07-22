/**
 * Testes E2E de UI — CRUD de Espelhamentos (MirrorsPage)
 *
 * Requer: Web rodando em http://localhost:15441 (E2E stack)
 *
 * Cobertura:
 *   - Empty state (nenhum espelhamento)
 *   - Populated state (lista com dados)
 *   - Expansão inline de detalhes
 *   - Ativação/desativação via toggle
 *   - Exclusão com confirmação
 *   - Cancelar exclusão
 *   - Busca textual
 *   - Console sem erros JS
 */

import { test, expect } from '@playwright/test';
import { uniqueEmail, TEST_PASSWORD, TEST_NAME } from './helpers.ts';

const WEB = process.env.WEB_URL || `http://localhost:${process.env.WEB_PORT || '15441'}`;
const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

/**
 * Helper: registra um usuário via API e configura o token diretamente
 * no localStorage para login instantâneo sem passar pelo formulário.
 */
async function loginDirect(page: { goto: (url: string) => Promise<void>; evaluate: (fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]) => Promise<unknown>; waitForSelector: (sel: string, opts?: object) => Promise<void> }): Promise<string> {
  const email = uniqueEmail();
  const password = TEST_PASSWORD;

  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: TEST_NAME, password }),
  });
  const data = await res.json() as { success: boolean; token: string; user: { id: number } };
  const { token } = data;

  // Set token in localStorage
  await page.goto(`${WEB}/`);
  await page.evaluate((t: string) => {
    localStorage.setItem('omestre_auth_token', t);
  }, token);

  // Reload to pick up the token
  await page.goto(`${WEB}/`);

  // Aguarda dashboard carregar
  await page.waitForSelector('text=Atalhos Rápidos', { timeout: 15_000 });

  return token;
}

/**
 * Helper: navega para a página de espelhamentos via sidebar e aguarda carregar.
 */
async function navigateToMirrors(page: { click: (sel: string) => Promise<void>; waitForSelector: (sel: string, opts?: object) => Promise<void> }) {
  await page.click('button:has-text("Espelhamentos")');
  await page.waitForSelector('text=📋 Espelhamentos');
}

/**
 * Helper: cria um espelhamento via API para testes de listagem populada.
 */
async function createMirror(token: string, name: string, status: string = 'active') {
  await fetch(`${API}/api/mirrors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      status,
      sourceGroups: [{ jid: 'source@g.us', name: 'Fonte Ofertas' }],
      targetGroups: [{ jid: 'target@g.us', name: 'Grupo VIP' }],
    }),
  });
}

test.describe('Mirrors UI — Lista e Ações', () => {
  let token: string;

  test.beforeEach(async ({ page }) => {
    token = await loginDirect(page);
  });

  test('1.0 — Empty state: exibe "Nenhum espelhamento cadastrado ainda"', async ({ page }) => {
    await navigateToMirrors(page);

    await expect(page.locator('text=Nenhum espelhamento cadastrado ainda')).toBeVisible();
  });

  test('2.0 — Populated state: exibe espelhamentos na lista', async ({ page }) => {
    await createMirror(token, 'Ofertas Diárias');
    await navigateToMirrors(page);

    await expect(page.locator('text=Ofertas Diárias')).toBeVisible();
    await expect(page.locator('text=Ativo').first()).toBeVisible();
  });

  test('2.1 — Badge Inativo visível', async ({ page }) => {
    await createMirror(token, 'Desativado', 'inactive');
    await navigateToMirrors(page);

    await expect(page.locator('text=Inativo').first()).toBeVisible();
  });

  test('2.2 — Exibe contagem de registros', async ({ page }) => {
    await createMirror(token, 'Mirror A');
    await createMirror(token, 'Mirror B');
    await navigateToMirrors(page);

    await expect(page.locator('text=2 registro(s)')).toBeVisible();
  });

  test('3.0 — Expansão inline exibe detalhes', async ({ page }) => {
    await createMirror(token, 'Expansível');
    await navigateToMirrors(page);

    await page.locator('text=Expansível').click();
    await page.waitForTimeout(300);

    await expect(page.locator('text=Fonte Ofertas').first()).toBeVisible();
    await expect(page.locator('text=Grupo VIP').first()).toBeVisible();
  });

  test('4.0 — Toggle desativar funciona', async ({ page }) => {
    await createMirror(token, 'Toggle Test');
    await navigateToMirrors(page);

    const toggleBtn = page.locator('button[title="Desativar"]').first();
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Espelhamento desativado').first()).toBeVisible();
  });

  test('4.1 — Toggle ativar funciona', async ({ page }) => {
    await createMirror(token, 'Reativar Test', 'inactive');
    await navigateToMirrors(page);

    const activateBtn = page.locator('button[title="Ativar"]').first();
    await expect(activateBtn).toBeVisible();
    await activateBtn.click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Espelhamento ativado').first()).toBeVisible();
  });

  test('5.0 — Delete abre diálogo de confirmação', async ({ page }) => {
    await createMirror(token, 'Deletável');
    await navigateToMirrors(page);

    await page.locator('button[title="Excluir"]').first().click();
    await page.waitForTimeout(300);

    await expect(page.locator('text=Excluir Espelhamento').first()).toBeVisible();
  });

  test('5.1 — Cancelar exclusão fecha diálogo', async ({ page }) => {
    await createMirror(token, 'Cancelável');
    await navigateToMirrors(page);

    await page.locator('button[title="Excluir"]').first().click();
    await page.waitForTimeout(300);

    await page.locator('button:has-text("Cancelar")').first().click();
    await page.waitForTimeout(300);

    await expect(page.locator('text=Cancelável')).toBeVisible();
  });

  test('5.2 — Confirmar exclusão remove espelhamento', async ({ page }) => {
    await createMirror(token, 'Remover');
    await navigateToMirrors(page);

    await page.locator('button[title="Excluir"]').first().click();
    await page.waitForTimeout(300);

    // Dialog "Excluir Espelhamento" + "Cancelar" + "Excluir" buttons
    await page.locator('button:has-text("Excluir")').last().click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Espelhamento excluído').first()).toBeVisible();
  });

  test('6.0 — Busca encontra resultado', async ({ page }) => {
    await createMirror(token, 'Encontrável');
    await createMirror(token, 'Outro Mirror');
    await navigateToMirrors(page);

    await page.locator('input[placeholder="Digite o nome do espelhamento..."]').fill('Encontrável');
    await page.locator('button:has-text("Buscar")').click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Encontrável')).toBeVisible();
  });

  test('6.1 — Busca sem resultados exibe mensagem', async ({ page }) => {
    await navigateToMirrors(page);

    await page.locator('input[placeholder="Digite o nome do espelhamento..."]').fill('ZZZ_NAO_EXISTE');
    await page.locator('button:has-text("Buscar")').click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Nenhum espelhamento encontrado para esta busca')).toBeVisible();
  });

  test('6.2 — Limpar reseta busca', async ({ page }) => {
    await createMirror(token, 'Resetável');
    await navigateToMirrors(page);

    await page.locator('input[placeholder="Digite o nome do espelhamento..."]').fill('ZZZ');
    await page.locator('button:has-text("Buscar")').click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Limpar")').click();
    await page.waitForTimeout(500);

    await expect(page.locator('text=Resetável')).toBeVisible();
  });

  test('7.0 — Navegação sem erros JS fatais', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await loginDirect(page);
    await navigateToMirrors(page);
    await page.waitForTimeout(1000);

    // Ignora erros de favicon e recursos não críticos comuns em headless
    const fatalErrors = errors.filter(
      (e) =>
        (e.includes('500') || e.includes('Failed to load') || e.includes('Uncaught')) &&
        !e.includes('favicon') &&
        !e.includes('.ico') &&
        !e.includes('ERR_FAILED'),
    );
    expect(fatalErrors).toEqual([]);
  });

  test('8.0 — Página carrega sem crash', async ({ page }) => {
    await loginDirect(page);
    await navigateToMirrors(page);
    await page.waitForTimeout(2000);

    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
    expect(bodyText!.length).toBeGreaterThan(50);
  });
});
