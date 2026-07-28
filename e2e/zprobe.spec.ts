import { test } from '@playwright/test';

test('probe SettingsPage tabs', async ({ page }) => {
  // Cria o usuário direto pela API
  await fetch('http://localhost:15442/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'probe6@x.com', name: 'probe', password: 'senha123' }),
  });
  // Faz login pelo formulário
  await page.goto('http://localhost:15441/login');
  await page.fill('input[type="email"]', 'probe6@x.com');
  await page.fill('input[type="password"]', 'senha123');
  await page.click('button:has-text("Entrar")');
  await page.waitForTimeout(3000);
  console.log('URL após login:', page.url());
  await page.screenshot({ path: 'test-results/probe-after-login.png', fullPage: true });
  await page.waitForURL((u) => !u.toString().includes('/login'), { timeout: 15_000 });
  await page.goto('http://localhost:15441/settings');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const url = page.url();
  console.log('URL:', url);

  const tabsList = await page.locator('[role="tablist"]').count();
  console.log('TABLIST count:', tabsList);

  const triggersByRole = await page.locator('[role="tab"]').allTextContents();
  console.log('[role=tab] texts:', JSON.stringify(triggersByRole));

  const buttons = await page.locator('button').allInnerTexts();
  console.log('BUTTONS:', JSON.stringify(buttons));

  const tablistHTML = await page
    .locator('[role="tablist"]')
    .innerHTML()
    .catch(() => 'NOT FOUND');
  console.log('TABLIST HTML:', tablistHTML);

  await page.screenshot({ path: 'test-results/probe-settings.png', fullPage: true });
});
