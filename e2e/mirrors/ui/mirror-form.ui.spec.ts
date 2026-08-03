/**
 * Testes E2E de UI — MirrorFormPage (suite unificada)
 *
 * Describes concatenados das branches:
 *   - Acessibilidade + axe-core (wt/t_ec9561dc, em main via 3d6761e)
 *   - Base + Dirty Guard (wt/t_6e7307b7, dev t_6e7307b7)
 *
 * Requer: Web em http://localhost:15441, API em http://localhost:15442 (E2E stack)
 */

/**
 * Testes E2E de UI — Acessibilidade do MirrorFormPage
 *
 * Valida as melhorias de a11y da branch wt/t_ec9561dc (commit b9be7c4):
 *   - aria-invalid + aria-describedby em campos com erro
 *   - labels conectados aos inputs (htmlFor)
 *   - focus management: após submit inválido, foco vai pro 1º campo com erro
 *   - focus management: após sucesso, foco vai pro título da página
 *   - Cards com role=group + aria-labelledby
 *   - Autocompletes com padrão combobox ARIA 1.2
 *
 * Requer: Web em http://localhost:15441, API em http://localhost:15442 (E2E stack)
 */

import { test, expect, type Page } from '@playwright/test';
import { uniqueEmail, TEST_PASSWORD, TEST_NAME } from '../../helpers/index.ts';

const WEB = process.env.WEB_URL || `http://localhost:${process.env.WEB_PORT || '15441'}`;
const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;
// API mirror (15447) aponta para o simulador WhatsApp — usada para criar
// mirrors com grupos admin válidos (validação "destino exige admin").
const API_MIRROR =
  process.env.API_MIRROR_URL || `http://localhost:${process.env.API_MIRROR_PORT || '15447'}`;

const EVIDENCE_DIR = 'test-results/mirror-form-evidence';
const FORM_CARD_TITLES = ['📋 Informações Básicas', '🔗 Grupos de Origem', '🎯 Grupos de Destino'];
const MOCK_GROUPS = [
  { jid: '120363000000000001@g.us', name: 'Ofertas Premium', isAdmin: true },
  { jid: '120363000000000002@g.us', name: 'Grupo VIP Compras', isAdmin: true },
  { jid: '120363@g.us', name: 'Ofertas Tech Brasil', isAdmin: true },
  { jid: '120364@g.us', name: 'Promoções do Dia', isAdmin: true },
  { jid: '120365@g.us', name: 'Grupo VIP Ofertas', isAdmin: true },
  { jid: '120366@g.us', name: 'Achadinhos Shopee', isAdmin: true },
];

/**
 * Helper: registra + configura token no localStorage (login instantâneo).
 */
async function loginDirect(page: Page): Promise<string> {
  const email = uniqueEmail();
  const password = TEST_PASSWORD;

  const res = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: TEST_NAME, password }),
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

/**
 * Helper: navega para a página de NOVO espelhamento via URL direta.
 */
async function navigateToNewMirrorForm(page: Page) {
  await page.goto(`${WEB}/mirror-form`);
  // Aguarda o form carregar (título "Novo Espelhamento")
  await page.waitForSelector('h1:has-text("Novo Espelhamento")', { timeout: 10_000 });
}

async function createMirror(token: string, name: string) {
  // Cria via API mirror (15447): o simulador retorna grupos admin, então a
  // validação "destino exige admin" aceita. O Postgres é compartilhado entre
  // api-e2e e api-e2e-mirror — o mirror fica visível na API padrão também.
  // Garante instância conectada no simulador (admin dos grupos de destino)
  await connectWhatsAppMirror(token);

  const res = await fetch(`${API_MIRROR}/api/mirrors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name,
      status: 'active',
      sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
      targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
    }),
  });
  const data = (await res.json()) as { success: boolean; mirror?: { id: number } };
  if (!data.mirror) {
    throw new Error(`createMirror falhou: ${res.status} ${JSON.stringify(data)}`);
  }
  return data.mirror.id;
}

/**
 * Conecta o WhatsApp no simulador (idempotente) para que o usuário seja
 * admin dos grupos de destino na API mirror (15447).
 */
async function connectWhatsAppMirror(token: string) {
  await fetch(`${API_MIRROR}/api/whatsapp/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: '{}',
  });
}

async function mockWhatsAppGroups(page: Page) {
  await page.route('**/api/whatsapp/groups**', (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, groups: MOCK_GROUPS }),
    });
  });
}

/**
 * Mocka POST /api/mirrors → sucesso. Necessário porque o E2E roda sem
 * WhatsApp conectado na API padrão (15442), e a validação "destino exige
 * admin" (feature 271bf31) rejeita o POST real com 400.
 */
async function mockCreateMirror(page: Page) {
  await page.route('**/api/mirrors', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as {
      name?: string;
      sourceGroups?: unknown[];
      targetGroups?: unknown[];
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        mirror: {
          id: 999,
          name: body.name ?? 'Espelho',
          status: 'active',
          sourceGroups: body.sourceGroups ?? [],
          targetGroups: body.targetGroups ?? [],
          messageTemplate: null,
        },
      }),
    });
  });
}

async function openCreateForm(page: Page) {
  await page.goto(`${WEB}/mirror-form`);
  await page.waitForSelector('form', { timeout: 15_000 });
  // Aguarda o campo nome estar visível
  await expect(page.locator('input[placeholder*="Ofertas Diárias"]')).toBeVisible();
}

async function openEditForm(page: Page, mirrorId: number) {
  await page.goto(`${WEB}/mirror-form/${mirrorId}`);
  // Loading inicial → fetch → form com campos preenchidos
  await page.waitForSelector('form', { timeout: 15_000 });
  await expect(page.locator('input[placeholder*="Ofertas Diárias"]')).toBeVisible();
}

async function setReactInputValue(page: Page, selector: string, value: string): Promise<void> {
  await page.evaluate(
    ({ sel, v }) => {
      const input = document.querySelector(sel) as HTMLInputElement | null;
      if (!input) return;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      if (!nativeSetter) return;
      nativeSetter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    },
    { sel: selector, v: value },
  );
}

async function selectGroup(
  page: Page,
  queryText: string,
  groupText: string,
  opts: { target?: boolean } = {},
) {
  const placeholder = opts.target ? 'Buscar grupo de destino...' : 'Buscar grupo...';
  const input = page.locator(`input[placeholder="${placeholder}"]`);
  await input.click();
  await input.fill(queryText);
  await page.waitForTimeout(200);
  await page.locator(`text=${groupText}`).first().click();
  await page.waitForTimeout(200);
}

test.describe('MirrorFormPage — Acessibilidade', () => {
  test.beforeEach(async ({ page }) => {
    await loginDirect(page);
  });

  test('1.0 — Labels conectados aos inputs via htmlFor/id + asterisco de obrigatorio', async ({
    page,
  }) => {
    await navigateToNewMirrorForm(page);

    // O Input component gera id="input-nome-do-espelhamento" ou usa id explícito "mirror-form-nome"
    // Verifica que existe label com htmlFor apontando para o input
    const nomeInput = page.locator('#mirror-form-nome');
    await expect(nomeInput).toBeVisible();

    // Label deve ter htmlFor="mirror-form-nome"
    const nomeLabel = page.locator('label[for="mirror-form-nome"]');
    await expect(nomeLabel).toBeVisible();
    // O asterisco de obrigatoriedade (critério 5) faz o texto incluir " *",
    // então validamos o nome-base em vez de toHaveText exato.
    await expect(nomeLabel).toContainText('Nome do Espelhamento');
    // Asterisco presente (aria-hidden via Input.tsx)
    await expect(nomeLabel).toContainText('*');
    // Asterisco é decorativo: aria-hidden="true" para nao ser lido pelo leitor de tela
    await expect(nomeLabel.locator('span[aria-hidden="true"]')).toContainText('*');
  });

  test('2.0 — Campo nome com erro tem aria-invalid=true e aria-describedby', async ({ page }) => {
    await navigateToNewMirrorForm(page);

    const nomeInput = page.locator('#mirror-form-nome');

    // Submete o form vazio para disparar validação
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);

    // Verifica aria-invalid=true
    await expect(nomeInput).toHaveAttribute('aria-invalid', 'true');

    // Verifica aria-describedby apontando para a mensagem de erro
    const describedBy = await nomeInput.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    // O elemento referenciado deve existir e conter a mensagem de erro
    const errorElement = page.locator(`#${describedBy}`);
    await expect(errorElement).toBeVisible();
    await expect(errorElement).toHaveText(/obrigatório/i);

    // A mensagem de erro deve ter role="alert"
    await expect(errorElement).toHaveAttribute('role', 'alert');
  });

  test('3.0 — Submit inválido foca o primeiro campo com erro (nome)', async ({ page }) => {
    await navigateToNewMirrorForm(page);

    // Submete form vazio — todos os campos são obrigatórios
    await page.click('button[type="submit"]');
    await page.waitForTimeout(500);

    // O foco deve ir para o campo nome (primeiro com erro)
    const activeElementId = await page.evaluate(() => document.activeElement?.id);
    expect(activeElementId).toBe('mirror-form-nome');
  });

  test('4.0 — Cards têm role=group e aria-labelledby', async ({ page }) => {
    await navigateToNewMirrorForm(page);

    // Card "Informações Básicas"
    const cardInfos = page.locator('[role="group"]').first();
    await expect(cardInfos).toBeVisible();
    const labelledBy = await cardInfos.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    // O título referenciado deve existir
    const titleElement = page.locator(`#${labelledBy}`);
    await expect(titleElement).toBeVisible();
    await expect(titleElement).toContainText('Informações Básicas');
  });

  test('5.0 — Autocomplete de origem tem padrão combobox ARIA', async ({ page }) => {
    await navigateToNewMirrorForm(page);

    const origemInput = page.locator('#mirror-form-origem-input');
    await expect(origemInput).toBeVisible();

    // Verifica role=combobox
    await expect(origemInput).toHaveAttribute('role', 'combobox');

    // Verifica aria-expanded
    await expect(origemInput).toHaveAttribute('aria-expanded', 'false');

    // Verifica aria-controls apontando para listbox
    const controls = await origemInput.getAttribute('aria-controls');
    expect(controls).toBeTruthy();

    // Verifica aria-autocomplete
    await expect(origemInput).toHaveAttribute('aria-autocomplete', 'list');
  });

  test('6.0 — Autocomplete abre listbox ao focar', async ({ page }) => {
    await navigateToNewMirrorForm(page);

    // Aguarda autocomplete carregar (pode estar em loading)
    await page.waitForTimeout(1000);

    const origemInput = page.locator('#mirror-form-origem-input');
    await origemInput.focus();
    await page.waitForTimeout(300);

    // aria-expanded deve ser true
    await expect(origemInput).toHaveAttribute('aria-expanded', 'true');

    // Listbox deve estar visível (se houver grupos)
    const controls = await origemInput.getAttribute('aria-controls');
    const listbox = page.locator(`#${controls}`);
    // Listbox pode ou não estar visível dependendo se há grupos cadastrados
    // Mas se estiver visível, deve ter role=listbox
    if (await listbox.isVisible()) {
      await expect(listbox).toHaveAttribute('role', 'listbox');
    }
  });

  test('7.0 — Após sucesso, focus move para o título da página', async ({ page }) => {
    // Mock da API de grupos (usada pelos autocompletes de origem e destino)
    await page.route('**/api/whatsapp/groups*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          groups: [
            { jid: 'src-group@g.us', name: 'Grupo Fonte', isAdmin: true },
            { jid: 'dst-group@g.us', name: 'Grupo Destino', isAdmin: true },
          ],
        }),
      });
    });

    // Mock do POST /api/mirrors → sucesso
    await page.route('**/api/mirrors', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mirror: {
            id: 999,
            name: 'Teste A11y Sucesso',
            userId: 1,
            status: 'active',
            sourceGroups: [{ jid: 'src-group@g.us', name: 'Grupo Fonte' }],
            targetGroups: [{ jid: 'dst-group@g.us', name: 'Grupo Destino' }],
            messageTemplate: null,
            subRateLimitMaxMsgs: null,
            subRateLimitWindowSec: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      });
    });

    await navigateToNewMirrorForm(page);

    // Preenche o nome
    await page.fill('#mirror-form-nome', 'Teste A11y Sucesso');

    // Seleciona grupo de origem via combobox (opção do listbox)
    const origemInput = page.locator('#mirror-form-origem-input');
    await origemInput.focus();
    const origemOption = page.locator('#mirror-form-origem-input-listbox [role="option"]');
    await origemOption.first().waitFor({ state: 'visible', timeout: 5000 });
    await origemOption.first().click();

    // Seleciona grupo de destino via combobox
    const destinoInput = page.locator('#mirror-form-destino-input');
    await destinoInput.focus();
    const destinoOption = page.locator('#mirror-form-destino-input-listbox [role="option"]');
    await destinoOption.first().waitFor({ state: 'visible', timeout: 5000 });
    await destinoOption.first().click();

    // Submete o form
    await page.click('button[type="submit"]');

    // Success overlay renderiza — título da página recebe foco via useEffect
    const successTitle = page.locator('#mirror-form-success-title');
    await expect(successTitle).toBeVisible();

    // Verifica document.activeElement apontando para o título
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id), {
        timeout: 2000,
        intervals: [50, 100, 200],
      })
      .toBe('mirror-form-success-title');
  });

  test('8.0 — Console sem erros JS fatais ao navegar para o form', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await navigateToNewMirrorForm(page);
    await page.waitForTimeout(1000);

    const fatalErrors = errors.filter(
      (e) =>
        (e.includes('500') || e.includes('Failed to load') || e.includes('Uncaught')) &&
        !e.includes('favicon') &&
        !e.includes('.ico') &&
        !e.includes('ERR_FAILED'),
    );
    expect(fatalErrors).toEqual([]);
  });
});

test.describe('axe-core — Auditoria de acessibilidade', () => {
  test('9.0 — axe-core reporta violações críticas no form', async ({ page }) => {
    await loginDirect(page);
    await navigateToNewMirrorForm(page);
    await page.waitForTimeout(1000);

    // Injeta axe-core via CDN e roda auditoria
    const violations = await page.evaluate(async () => {
      // Carrega axe-core
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.8.4/axe.min.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load axe-core'));
        document.head.appendChild(script);
      });

      // Aguarda axe estar disponível
      await new Promise<void>((resolve) => {
        const check = () => {
          if ((window as any).axe) resolve();
          else setTimeout(check, 100);
        };
        check();
      });

      // Roda auditoria
      const results = await (window as any).axe.run(document.body, {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
        },
      });

      // Filtra apenas violações de impacto crítico ou sério
      return results.violations
        .filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
        .map((v: any) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          nodes: v.nodes.length,
        }));
    });

    // Reporta violações encontradas (mas não falha o teste automaticamente)
    // O objetivo é ter visibilidade, não bloquear o deploy
    if (violations.length > 0) {
      console.log('axe-core violations found:', JSON.stringify(violations, null, 2));
    }

    // Espera zero violações críticas
    expect(violations.length).toBe(0);
  });
});

test.describe('MirrorFormPage — Base', () => {
  test.beforeEach(async ({ page }) => {
    await loginDirect(page);
  });

  test('1.0 — /mirror-form carrega com form visível', async ({ page }) => {
    await openCreateForm(page);

    // Título da página
    await expect(page.locator('text=Novo Espelhamento').first()).toBeVisible();

    // Card de Informações Básicas
    await expect(page.locator('text=📋 Informações Básicas')).toBeVisible();
    // Card de Grupos de Origem
    await expect(page.locator('text=🔗 Grupos de Origem')).toBeVisible();
    // Card de Grupos de Destino
    await expect(page.locator('text=🎯 Grupos de Destino')).toBeVisible();

    // Botão de submit visível
    await expect(page.getByRole('button', { name: 'Criar Espelhamento' })).toBeVisible();
    // Botão Cancelar visível
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE_DIR}/base-form-criacao.png` });
  });

  test('1.1 — /mirror-form/:id abre edição com campos preenchidos', async ({ page }) => {
    // Mocka WhatsApp para o autocomplete renderizar os chips corretamente
    await mockWhatsAppGroups(page);

    // Recupera o token do localStorage para criar via API
    const authToken = await page.evaluate(() => localStorage.getItem('omestre_auth_token'));
    expect(authToken).toBeTruthy();

    const mirrorId = await createMirror(authToken!, 'Mirror Editável');
    await openEditForm(page, mirrorId);

    // Título muda para "Editar Espelhamento"
    await expect(page.locator('text=Editar Espelhamento').first()).toBeVisible();

    // Campo nome preenchido com o valor criado
    const nameInput = page.locator('input[placeholder*="Ofertas Diárias"]');
    await expect(nameInput).toHaveValue('Mirror Editável');

    // Chips dos grupos selecionados (vindos da API — nomes do simulador)
    await expect(page.locator('text=Ofertas Promoções').first()).toBeVisible();
    await expect(page.locator('text=Grupo Teste 3').first()).toBeVisible();

    // Botão de submit diz "Atualizar"
    await expect(page.getByRole('button', { name: 'Atualizar Espelhamento' })).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE_DIR}/base-form-edicao.png` });
  });

  test('1.2 — Criação com dados válidos: nome + 1 grupo origem + 1 destino → success', async ({
    page,
  }) => {
    // Mocka o endpoint de grupos WhatsApp (em E2E sem WhatsApp conectado)
    await mockWhatsAppGroups(page);
    // Mocka o POST /api/mirrors (validação de admin exige WhatsApp real)
    await mockCreateMirror(page);
    await openCreateForm(page);
    await page.waitForTimeout(500); // estabiliza autocomplete após mock

    // Preencher nome (via setter React para disparar onChange)
    await setReactInputValue(page, 'input[placeholder*="Ofertas Diárias"]', 'Espelho QA E2E');

    // Selecionar 1 grupo de origem (autocomplete "Buscar grupo...")
    await selectGroup(page, 'Ofertas', 'Ofertas Premium');
    // Selecionar 1 grupo de destino (autocomplete "Buscar grupo de destino...")
    await selectGroup(page, 'VIP', 'Grupo VIP Compras', { target: true });

    // Submeter
    await page.getByRole('button', { name: 'Criar Espelhamento' }).click();

    // Tela de success visível
    await expect(page.locator('text=Espelhamento criado com sucesso!')).toBeVisible({
      timeout: 10_000,
    });

    await page.screenshot({ path: `${EVIDENCE_DIR}/base-criacao-success.png` });
  });
});

// ════════════════════════════════════════════════════════════════════════
// DIRTY GUARD — sair sem salvar pede confirmação
// ════════════════════════════════════════════════════════════════════════

test.describe('MirrorFormPage — Dirty Guard', () => {
  test.beforeEach(async ({ page }) => {
    await loginDirect(page);
  });

  test('2.0 — Editar nome + Cancelar: dialog aparece; cancelar mantém; confirmar sai', async ({
    page,
  }) => {
    await openCreateForm(page);

    // Editar o nome (form fica sujo) — usar setter nativo do React
    const nameInput = page.locator('input[placeholder*="Ofertas Diárias"]');
    await nameInput.click();
    await setReactInputValue(page, 'input[placeholder*="Ofertas Diárias"]', 'Nome alterado sujo');
    await nameInput.blur();
    await page.waitForTimeout(300);

    // Mensagem esperada do confirm em PT-BR
    const CONFIRM_MSG = 'Existem mudanças não salvas. Deseja realmente sair?';

    // ─── 2.0.a — Botão Cancelar: dialog aparece
    // Registra o handler de dialog ANTES do clique (race-safe)
    let dialogMsg = '';
    let dialogShown = false;
    const dialogHandler = (d: import('@playwright/test').Dialog) => {
      dialogShown = true;
      dialogMsg = d.message();
      void d.dismiss();
    };
    page.on('dialog', dialogHandler);

    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Espera o dialog ser capturado
    await expect.poll(() => dialogShown, { timeout: 5000 }).toBe(true);
    expect(dialogMsg).toBe(CONFIRM_MSG);

    // ─── 2.0.b — Após cancelar: continua na página
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/mirror-form$/);
    // Form ainda visível
    await expect(page.locator('form')).toBeVisible();
    // O nome editado permanece no campo
    await expect(nameInput).toHaveValue('Nome alterado sujo');

    await page.screenshot({
      path: `${EVIDENCE_DIR}/dirty-cancel-mantem.png`,
    });

    // ─── 2.0.c — Mesmo botão, mas dessa vez confirmando: sai da página
    // Remove o handler anterior e adiciona um que aceita
    page.off('dialog', dialogHandler);
    const acceptHandler = (d: import('@playwright/test').Dialog) => {
      dialogShown = true;
      dialogMsg = d.message();
      void d.accept();
    };
    page.on('dialog', acceptHandler);
    dialogShown = false;
    dialogMsg = '';

    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Espera o dialog ser capturado
    await expect.poll(() => dialogShown, { timeout: 5000 }).toBe(true);
    expect(dialogMsg).toBe(CONFIRM_MSG);

    // Redireciona para /mirrors
    await page.waitForURL(/\/mirrors$/, { timeout: 10_000 });

    page.off('dialog', acceptHandler);
    await page.screenshot({
      path: `${EVIDENCE_DIR}/dirty-cancel-confirmou-saiu.png`,
    });
  });

  test('2.1 — Sem edição + Cancelar: sai direto sem dialog', async ({ page }) => {
    await openCreateForm(page);

    // Sem editar nada — o form deve estar limpo (snapshot = EMPTY_SNAPSHOT)
    // Nenhum dialog deve aparecer
    let dialogShown = false;
    page.on('dialog', (d) => {
      dialogShown = true;
      void d.dismiss();
    });

    await page.getByRole('button', { name: 'Cancelar' }).click();

    // Redireciona sem pedir confirmação
    await page.waitForURL(/\/mirrors$/, { timeout: 5000 });
    expect(dialogShown).toBe(false);

    await page.screenshot({ path: `${EVIDENCE_DIR}/dirty-sem-edicao-direto.png` });
  });

  test('2.2 — Após salvar com sucesso, voltar não pede confirmação', async ({ page }) => {
    // Mocka WhatsApp + POST /api/mirrors para a criação funcionar
    await mockWhatsAppGroups(page);
    await mockCreateMirror(page);
    await openCreateForm(page);
    await page.waitForTimeout(500);

    // Preencher e salvar
    await setReactInputValue(page, 'input[placeholder*="Ofertas Diárias"]', 'Dirty guard reset');
    await selectGroup(page, 'Ofertas', 'Ofertas Premium');
    await selectGroup(page, 'VIP', 'Grupo VIP Compras', { target: true });

    await page.getByRole('button', { name: 'Criar Espelhamento' }).click();
    // Tela de success aparece (sem auto-redirect — feature do
    // wt/t_7051622a, validada em 5.0/5.1/5.2/5.3). Aqui clicamos em
    // "Ver espelhamentos" para navegar manualmente.
    await expect(page.locator('text=Espelhamento criado com sucesso!')).toBeVisible({
      timeout: 10_000,
    });
    await page.getByRole('button', { name: 'Ver espelhamentos' }).click();
    await page.waitForURL(/\/mirrors$/, { timeout: 5_000 });

    // Agora clica em "Novo" → form de criação limpo
    // (snapshot resetado após save no componente)
    await page.getByRole('button', { name: 'Novo' }).first().click();
    await page.waitForURL(/\/mirror-form$/, { timeout: 10_000 });
    await expect(page.locator('form')).toBeVisible();

    // Clica em Cancelar — não deve pedir confirmação (form limpo)
    let dialogShown = false;
    page.on('dialog', (d) => {
      dialogShown = true;
      void d.dismiss();
    });
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await page.waitForURL(/\/mirrors$/, { timeout: 5_000 });
    expect(dialogShown).toBe(false);

    await page.screenshot({ path: `${EVIDENCE_DIR}/dirty-pos-save-sem-confirm.png` });
  });

  test('2.3 — beforeunload: handler existe quando form está sujo', async ({ page }) => {
    await openCreateForm(page);

    // 2.3.a — Form limpo: nenhum handler beforeunload instalado pelo componente
    // O componente instala o listener só quando isDirty=true. Disparar
    // beforeunload num form limpo NÃO aciona preventDefault pelo handler do app.
    const cleanReturnValue = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(cleanReturnValue).toBe(false);

    // 2.3.b — Editar o nome (form fica sujo → useEffect instala o handler)
    // É importante focar o input antes para que o React ative o handler
    // de change e o onChange dispare corretamente.
    const nameInput = page.locator('input[placeholder*="Ofertas Diárias"]');
    await nameInput.click();
    await setReactInputValue(
      page,
      'input[placeholder*="Ofertas Diárias"]',
      'Form sujo para teste de beforeunload',
    );
    await page.waitForTimeout(500); // useEffect aplica o listener + React batch

    // Disparar beforeunload novamente: agora o handler instalado pelo
    // componente chama e.preventDefault() → defaultPrevented = true
    const dirtyReturnValue = await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(dirtyReturnValue).toBe(true);

    await page.screenshot({ path: `${EVIDENCE_DIR}/dirty-beforeunload-handler.png` });
  });
});

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

function collectFatalErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => errors.push(`Uncaught: ${err.message}`));
  return errors;
}

function fatalOnly(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      (e.includes('500') || e.includes('Failed to load') || e.includes('Uncaught')) &&
      !e.includes('favicon') &&
      !e.includes('.ico') &&
      !e.includes('ERR_FAILED'),
  );
}

test.describe('MirrorForm — Sticky actions (mobile 390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ page }) => {
    await loginDirect(page);
  });

  test('1.0 — Mobile: barra de ações continua visível ao rolar o form (sticky)', async ({
    page,
  }) => {
    // Viewport mobile menor (390x600): o form E2E tem ~643px (WhatsApp desconectado
    // → autocompletes compactos), então em 390x844 não há scroll para exercitar o
    // sticky. A regra é de largura (max-width: 767px), não de altura.
    await page.setViewportSize({ width: 390, height: 600 });
    await openCreateForm(page);
    // Espera autocompletes estabilizarem a altura do form
    await page.waitForTimeout(800);

    const bar = page.locator('.form-actions-bar');
    const before = await page.evaluate(() => {
      const bar = document.querySelector('.form-actions-bar')!;
      const barRect = bar.getBoundingClientRect();
      return {
        vh: window.innerHeight,
        pageH: document.documentElement.scrollHeight,
        maxScroll: document.documentElement.scrollHeight - window.innerHeight,
        formBottom: document.querySelector('form')!.getBoundingClientRect().bottom,
        barTop: barRect.top,
        barBottom: barRect.bottom,
        barHeight: barRect.height,
      };
    });

    // Pré-condição: o fim do form está abaixo da dobra (senão o sticky não engaja)
    expect(before.formBottom).toBeGreaterThan(before.vh + before.barHeight + 20);
    expect(before.maxScroll).toBeGreaterThan(50);

    // Computed style: position sticky no mobile
    const position = await bar.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('sticky');

    // Sem scroll: posição natural da barra (formBottom - barHeight) está abaixo da
    // dobra → sticky bottom:0 já a prende no rodapé da viewport. Se o sticky não
    // existisse, a barra ficaria invisível (y ≈ 741 > 600).
    await expect(bar).toBeInViewport();
    expect(Math.abs(before.barBottom - before.vh)).toBeLessThanOrEqual(2);
    expect(Math.abs(before.barTop + before.barHeight - before.formBottom)).toBeGreaterThan(40);

    // Full-bleed: barra ocupa a largura total da viewport
    const box0 = (await bar.boundingBox())!;
    expect(Math.abs(box0.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box0.width - 390)).toBeLessThanOrEqual(2);

    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile-sticky-bar-scroll0.png` });

    // Rola até o meio da página: a barra continua visível e presa no rodapé
    await page.evaluate((t: number) => window.scrollTo(0, t), Math.floor(before.maxScroll / 2));
    await page.waitForTimeout(300);

    await expect(bar).toBeInViewport();
    const boxMid = (await bar.boundingBox())!;
    expect(Math.abs(boxMid.y + boxMid.height - before.vh)).toBeLessThanOrEqual(2);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/mobile-sticky-bar-rolado.png`,
      fullPage: false,
    });
  });

  test('1.1 — Mobile: botões Salvar/Cancelar full-width (flex 1) na barra', async ({ page }) => {
    await openCreateForm(page);

    const bar = page.locator('.form-actions-bar');
    const buttons = bar.locator('> .Button');
    await expect(buttons).toHaveCount(2);

    // Ambos com flex-grow 1 → expandem para preencher a largura disponível
    const flexGrows = await buttons.evaluateAll((els) =>
      els.map((el) => getComputedStyle(el).flexGrow),
    );
    expect(flexGrows).toEqual(['1', '1']);

    const widths = await buttons.evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().width),
    );
    const barBox = (await bar.boundingBox())!;
    // Barra full-bleed: largura = viewport (padding lateral 1rem compensado por margens negativas)
    expect(Math.abs(barBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(barBox.width - 390)).toBeLessThanOrEqual(2);

    // Botões juntos preenchem a largura útil da barra (390 - 2*16 de padding - 12 de gap = 346)
    // Obs: flexbox com min-width do conteúdo pode deixar o botão maior ~10px mais largo
    // (texto + ícone "Criar Espelhamento" > "Cancelar") — comportamento padrão, não bug.
    const total = widths[0]! + widths[1]! + 12;
    expect(Math.abs(total - (barBox.width - 32))).toBeLessThanOrEqual(4);
    expect(widths[0]!).toBeGreaterThan(150);
    expect(widths[1]!).toBeGreaterThan(150);

    // Textos dos botões visíveis
    await expect(bar.getByRole('button', { name: 'Criar Espelhamento' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Cancelar' })).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile-botoes-fullwidth.png` });
  });

  test('1.2 — Mobile: cards do form renderizam sem overflow horizontal', async ({ page }) => {
    await openCreateForm(page);
    await page.waitForTimeout(500);

    for (const title of FORM_CARD_TITLES) {
      await expect(page.locator(`text=${title}`).first()).toBeVisible();
    }

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile-cards-form.png` });
  });

  test('1.3 — Mobile: navegação no form sem erros JS fatais', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openCreateForm(page);
    await page.waitForTimeout(1000);
    expect(fatalOnly(errors)).toEqual([]);
  });
});

test.describe('MirrorForm — Layout desktop (1280x800)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    await loginDirect(page);
  });

  test('2.0 — Desktop: barra de ações inline (static) no fim do form', async ({ page }) => {
    await openCreateForm(page);

    const bar = page.locator('.form-actions-bar');
    const position = await bar.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('static');

    // Barra é o último elemento do form (fluxo normal, sem sticky/fixed):
    // bottom da barra == bottom do form
    const formBox = (await page.locator('form').boundingBox())!;
    const barBox = (await bar.boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(formBox.y + formBox.height + 1);
    expect(barBox.y + barBox.height).toBeGreaterThanOrEqual(formBox.y + formBox.height - 120);

    // Botões visíveis
    await expect(bar.getByRole('button', { name: 'Criar Espelhamento' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Cancelar' })).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-botoes-inline.png` });
  });

  test('2.1 — Desktop: form centralizado com max-width padrão (960px)', async ({ page }) => {
    await openCreateForm(page);

    const formBox = (await page.locator('form').boundingBox())!;
    // max-width padrão do PageLayout (960px) — largura unificada (271bf31)
    expect(formBox.width).toBeGreaterThanOrEqual(959);
    expect(formBox.width).toBeLessThanOrEqual(961);

    // Centralizado em relação ao container pai (PageLayout inner)
    const parent = await page
      .locator('form')
      .evaluate((el) => el.parentElement!.getBoundingClientRect());
    const formCenter = formBox.x + formBox.width / 2;
    const parentCenter = parent.left + parent.width / 2;
    expect(Math.abs(formCenter - parentCenter)).toBeLessThanOrEqual(2);

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-form-centralizado.png` });
  });

  test('2.2 — Desktop: cards do form renderizam sem overflow', async ({ page }) => {
    await openCreateForm(page);
    await page.waitForTimeout(500);

    for (const title of FORM_CARD_TITLES) {
      await expect(page.locator(`text=${title}`).first()).toBeVisible();
    }

    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-cards-form.png` });
  });

  test('2.3 — Desktop: navegação no form sem erros JS fatais', async ({ page }) => {
    const errors = collectFatalErrors(page);
    await openCreateForm(page);
    await page.waitForTimeout(1000);
    expect(fatalOnly(errors)).toEqual([]);
  });
});

test.describe('MirrorsPage — sem regressão nos cards (sticky dev)', () => {
  test('3.0 — Mobile: lista de espelhamentos renderiza sem overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const token = await loginDirect(page);
    await createMirror(token, 'Ofertas Diárias');

    await page.goto(`${WEB}/mirrors`);
    await page.waitForSelector('text=📋 Espelhamentos', { timeout: 15_000 });

    await expect(page.locator('text=Ofertas Diárias')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/mobile-mirrors-cards.png` });
  });

  test('3.1 — Desktop: lista de espelhamentos renderiza sem overflow', async ({ page }) => {
    const token = await loginDirect(page);
    await createMirror(token, 'Ofertas Diárias');

    await page.goto(`${WEB}/mirrors`);
    await page.waitForSelector('text=📋 Espelhamentos', { timeout: 15_000 });

    await expect(page.locator('text=Ofertas Diárias')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-mirrors-cards.png` });
  });
});

function makeMockMirror(id: number, name: string) {
  return {
    id,
    name,
    userId: 1,
    status: 'active',
    sourceGroups: [{ jid: '120363@g.us', name: 'Ofertas Tech Brasil' }],
    targetGroups: [{ jid: '120366@g.us', name: 'Achadinhos Shopee' }],
    messageTemplate: null,
    subRateLimitMaxMsgs: null,
    subRateLimitWindowSec: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

async function selectFirstGroup(page: Page, autocompleteName: 'sourceGroups' | 'targetGroups') {
  const placeholder =
    autocompleteName === 'targetGroups' ? 'Buscar grupo de destino...' : 'Buscar grupo...';
  const trigger = page.locator(`input[placeholder="${placeholder}"]`);
  await trigger.click();

  // Aguarda dropdown abrir (item com cursor:pointer visível)
  const item = page.locator('div[style*="cursor: pointer"]').first();
  await item.waitFor({ state: 'visible', timeout: 5_000 });
  await item.click();
}

test.describe('MirrorForm — Skeleton shimmer no loading (edit mode)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('4.0 — Modo edição: skeleton (não spinner) aparece durante o fetch', async ({ page }) => {
    const _token = await loginDirect(page);

    // Mocka GET /api/mirrors/:id com delay CONTROLADO: o estado inicial do
    // form é loading=false; a UI só mostra o skeleton depois de
    // setLoading(true) ser chamado dentro de fetchMirror. Capturamos a
    // primeira resposta e só a liberamos após o teste inspecionar o
    // skeleton.
    let resolveFetch: (() => void) | null = null;
    const fetchBlocker = new Promise<void>((r) => {
      resolveFetch = r;
    });

    await page.route('**/api/mirrors/*', async (route) => {
      const request = route.request();
      if (request.method() !== 'GET') return route.continue();
      await fetchBlocker;
      const url = new URL(request.url());
      const id = parseInt(url.pathname.split('/').pop() ?? '1', 10);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, mirror: makeMockMirror(id, 'Teste Skeleton') }),
      });
    });

    await page.goto(`${WEB}/mirror-form/1`);

    // Antes da resposta: skeleton visível, spinner ausente
    const skeleton = page.locator('[role="status"][aria-busy="true"]');
    await expect(skeleton).toBeVisible({ timeout: 5_000 });

    // Pelo menos 1 .skeleton-block dentro do status
    const skeletonBlocks = page.locator('.skeleton-block');
    expect(await skeletonBlocks.count()).toBeGreaterThan(0);

    // Garantia: NÃO é o spinner antigo ("Carregando dados do espelhamento...")
    await expect(page.locator('text=Carregando dados do espelhamento...')).toHaveCount(0);

    // Skeleton computa shimmer animation (keyframe ativo)
    const animName = await skeletonBlocks
      .first()
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(animName).toBe('shimmer');

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-skeleton-edit.png` });

    // Libera o fetch e valida o form carregado
    resolveFetch!();
    await expect(page.locator('form')).toBeVisible({ timeout: 5_000 });
    await expect(skeleton).toHaveCount(0);

    // Mostra o nome carregado
    await expect(page.locator('input[value="Teste Skeleton"]')).toBeVisible();
  });
});

test.describe('MirrorForm — Success sem auto-redirect (modo novo)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('5.0 — Após salvar, success NÃO redireciona (aguarda >1.5s)', async ({ page }) => {
    await loginDirect(page);
    await mockWhatsAppGroups(page);

    // Mocka POST /api/mirrors para retornar sucesso sem fazer nada
    let postedBody: unknown = null;
    await page.route('**/api/mirrors', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      postedBody = JSON.parse(route.request().postData() ?? '{}');
      await new Promise((r) => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mirror: makeMockMirror(99, 'Teste Sem Redirect'),
        }),
      });
    });

    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });

    // Preenche nome e seleciona grupos
    await page
      .locator('input[placeholder="Ex: Ofertas Diárias → Grupo VIP"]')
      .fill('Teste Sem Redirect');
    await selectFirstGroup(page, 'sourceGroups');
    await selectFirstGroup(page, 'targetGroups');

    // Submit
    await page.locator('button:has-text("Criar Espelhamento")').click();

    // Success deve aparecer (sem auto-redirect)
    await expect(page.locator('text=Espelhamento criado com sucesso!')).toBeVisible({
      timeout: 5_000,
    });

    // AGUARDA >1.5s — se houvesse auto-redirect, a URL mudaria para /mirrors
    await page.waitForTimeout(2000);

    // URL NÃO mudou
    expect(page.url()).toContain('/mirror-form');
    expect(page.url()).not.toContain('/mirrors');

    // Success AINDA visível
    await expect(page.locator('text=Espelhamento criado com sucesso!')).toBeVisible();

    // Body do POST teve sourceGroups e targetGroups (validação backend)
    const body = postedBody as { sourceGroups: unknown[]; targetGroups: unknown[] } | null;
    expect(body).toBeTruthy();
    expect(body!.sourceGroups).toHaveLength(1);
    expect(body!.targetGroups).toHaveLength(1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-success-no-redirect.png` });
  });

  test('5.1 — Modo novo: botões "Criar outro espelhamento" e "Ver espelhamentos" são exibidos', async ({
    page,
  }) => {
    await loginDirect(page);
    await mockWhatsAppGroups(page);

    await page.route('**/api/mirrors', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mirror: makeMockMirror(99, 'Teste Acções'),
        }),
      });
    });

    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });

    await page.locator('input[placeholder="Ex: Ofertas Diárias → Grupo VIP"]').fill('Teste Acções');
    await selectFirstGroup(page, 'sourceGroups');
    await selectFirstGroup(page, 'targetGroups');
    await page.locator('button:has-text("Criar Espelhamento")').click();

    await expect(page.locator('text=Espelhamento criado com sucesso!')).toBeVisible({
      timeout: 5_000,
    });

    // Os DOIS botões do modo novo
    await expect(page.locator('button:has-text("Criar outro espelhamento")')).toBeVisible();
    await expect(page.locator('button:has-text("Ver espelhamentos")')).toBeVisible();

    // E o título "Novo Espelhamento" no header (não "Editar Espelhamento")
    await expect(page.locator('text=Novo Espelhamento').first()).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-success-acoes-novo.png` });
  });

  test('5.2 — Modo novo: "Criar outro espelhamento" reseta o form (campos vazios)', async ({
    page,
  }) => {
    await loginDirect(page);
    await mockWhatsAppGroups(page);

    await page.route('**/api/mirrors', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mirror: makeMockMirror(99, 'Teste Reset'),
        }),
      });
    });

    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });

    // Preenche
    await page.locator('input[placeholder="Ex: Ofertas Diárias → Grupo VIP"]').fill('Meu Mirror');
    await selectFirstGroup(page, 'sourceGroups');
    await selectFirstGroup(page, 'targetGroups');
    await page.locator('button:has-text("Criar Espelhamento")').click();

    await expect(page.locator('text=Espelhamento criado com sucesso!')).toBeVisible({
      timeout: 5_000,
    });

    // Clica "Criar outro espelhamento"
    await page.locator('button:has-text("Criar outro espelhamento")').click();
    await page.waitForSelector('form', { timeout: 5_000 });

    // Form resetado: campo nome vazio
    const nameInput = page.locator('input[placeholder="Ex: Ofertas Diárias → Grupo VIP"]');
    await expect(nameInput).toHaveValue('');

    // Tags de grupos (sourceGroups/targetGroups) sumiram — o nome do grupo
    // mockado (ex: "Ofertas Tech Brasil") não aparece mais no DOM
    await expect(page.locator('text=Ofertas Tech Brasil')).toHaveCount(0);
    await expect(page.locator('text=Achadinhos Shopee')).toHaveCount(0);

    // Os botões "×" de remoção também sumiram (não há tags para remover)
    await expect(page.locator('button[title="Remover"]')).toHaveCount(0);

    // Título segue "Novo Espelhamento"
    await expect(page.locator('text=Novo Espelhamento').first()).toBeVisible();

    // Success sumiu
    await expect(page.locator('text=Espelhamento criado com sucesso!')).toHaveCount(0);

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-form-reset.png` });
  });

  test('5.3 — Modo novo: "Ver espelhamentos" navega para /mirrors', async ({ page }) => {
    await loginDirect(page);
    await mockWhatsAppGroups(page);

    await page.route('**/api/mirrors', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          mirror: makeMockMirror(99, 'Teste Nav'),
        }),
      });
    });

    await page.goto(`${WEB}/mirror-form`);
    await page.waitForSelector('form', { timeout: 15_000 });

    await page.locator('input[placeholder="Ex: Ofertas Diárias → Grupo VIP"]').fill('Teste Nav');
    await selectFirstGroup(page, 'sourceGroups');
    await selectFirstGroup(page, 'targetGroups');
    await page.locator('button:has-text("Criar Espelhamento")').click();

    await expect(page.locator('text=Espelhamento criado com sucesso!')).toBeVisible({
      timeout: 5_000,
    });

    // Clica "Ver espelhamentos"
    await page.locator('button:has-text("Ver espelhamentos")').click();

    // Navegou para /mirrors
    await page.waitForURL(/\/mirrors$/, { timeout: 5_000 });
    await expect(page.locator('text=📋 Espelhamentos')).toBeVisible({ timeout: 5_000 });

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-success-nav-mirrors.png` });
  });
});

test.describe('MirrorForm — Success sem auto-redirect (modo edição)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('6.0 — Modo edição: botões "Ver espelhamentos" e "Fechar" são exibidos', async ({
    page,
  }) => {
    const _token = await loginDirect(page);

    // Mock GET /api/mirrors/:id + PUT /api/mirrors/:id
    await page.route('**/api/mirrors/*', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        const url = new URL(request.url());
        const id = parseInt(url.pathname.split('/').pop() ?? '1', 10);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, mirror: makeMockMirror(id, 'Edit Mode Test') }),
        });
        return;
      }
      if (request.method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            mirror: makeMockMirror(1, 'Edit Mode Test'),
          }),
        });
        return;
      }
      return route.continue();
    });

    await page.goto(`${WEB}/mirror-form/1`);
    await page.waitForSelector('form', { timeout: 15_000 });
    await expect(page.locator('input[value="Edit Mode Test"]')).toBeVisible();

    // Submit (PUT) — o botão usa o label "Atualizar Espelhamento" no edit mode
    await page.locator('button:has-text("Atualizar Espelhamento")').click();

    // Success do modo edição
    await expect(page.locator('text=Espelhamento atualizado com sucesso!')).toBeVisible({
      timeout: 5_000,
    });

    // Botões do modo edição
    await expect(page.locator('button:has-text("Ver espelhamentos")')).toBeVisible();
    await expect(page.locator('button:has-text("Fechar")')).toBeVisible();

    // Botão do modo novo NÃO aparece
    await expect(page.locator('button:has-text("Criar outro espelhamento")')).toHaveCount(0);

    // Aguarda >1.5s — sem auto-redirect
    await page.waitForTimeout(2000);
    expect(page.url()).toContain('/mirror-form/1');
    expect(page.url()).not.toContain('/mirrors');

    await page.screenshot({ path: `${EVIDENCE_DIR}/desktop-success-edit.png` });
  });

  test('6.1 — Modo edição: "Ver espelhamentos" navega para /mirrors', async ({ page }) => {
    const _token = await loginDirect(page);

    await page.route('**/api/mirrors/*', async (route) => {
      const request = route.request();
      if (request.method() === 'GET') {
        const url = new URL(request.url());
        const id = parseInt(url.pathname.split('/').pop() ?? '1', 10);
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, mirror: makeMockMirror(id, 'Edit Nav') }),
        });
        return;
      }
      if (request.method() === 'PUT') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            mirror: makeMockMirror(1, 'Edit Nav'),
          }),
        });
        return;
      }
      return route.continue();
    });

    await page.goto(`${WEB}/mirror-form/1`);
    await page.waitForSelector('form', { timeout: 15_000 });

    await page.locator('button:has-text("Atualizar Espelhamento")').click();

    await expect(page.locator('text=Espelhamento atualizado com sucesso!')).toBeVisible({
      timeout: 5_000,
    });

    await page.locator('button:has-text("Ver espelhamentos")').click();
    await page.waitForURL(/\/mirrors$/, { timeout: 5_000 });
    await expect(page.locator('text=📋 Espelhamentos')).toBeVisible({ timeout: 5_000 });
  });
});
