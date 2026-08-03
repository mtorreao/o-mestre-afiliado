import { defineConfig } from '@playwright/test';

const __dirname = import.meta.dir;
const WEB_PORT = process.env.WEB_PORT || '15441';
const API_PORT = process.env.API_PORT || '15442';
const API_MIRROR_PORT = process.env.API_MIRROR_PORT || '15447';
const SIMULATOR_PORT = process.env.SIMULATOR_PORT || '15446';

// Paralelização por arquivo (workers:2): isolado via escopo do simulador por
// instanceName (apps/whatsapp-simulator/src/index.ts aceita ?instanceName= em
// /__admin/messages e /__admin/reset). Cada teste usa seu proprio user-{id}
// (unico via uniqueEmail), eliminando colisão no estado do simulador.
//
// Antes (workers:1): mirror-flow e mirror-pipeline colidiam no sentMessages
// global → flake determinístico. Resolvido pela query ?instanceName=. Validado
// empiricamente: 223 passed em 2.8min com workers=2.
const WORKERS = 2;

export default defineConfig({
  testDir: __dirname,
  timeout: 20_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  // Retry no CI: cold-start/healthcheck do Docker pesado geram flake único;
  // um retry recupera sem custo de re-run manual do job.
  retries: process.env.CI ? 1 : 0,
  workers: WORKERS,
  // Fail-fast intencional: numa falha massiva (Ex: Evolution API caiu), rodar o
  // restante queima os 45min aos 15s por teste para chegar à mesma conclusão.
  // Parar no PRIMEIRO reduz tempo de feedback e economiza Actions. CI:1 (owner).
  // Local: 0 (ilimitado) p/ coletar TODAS as falhas e marcar skips no experimento.
  maxFailures: process.env.CI ? 1 : 0,

  // Report em CI: HTML (playwright-report/) + terminal. Screenshot e trace
  // só em falha — o job e2e do GitHub Actions sobe esses artefatos.
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
    screenshot: 'only-on-failure',
    // Trace só no retry (first): coleta forense para flake que passa no 2º run,
    // sem o peso de gravar trace de todo teste que passou.
    trace: process.env.CI ? 'on-first-retry' : 'retain-on-failure',
  },

  projects: [
    {
      name: 'api',
      testMatch: '**/*.api.spec.ts',
    },
    {
      name: 'ui',
      testMatch: ['**/*.ui.spec.ts', '**/zprobe.spec.ts'],
      use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mirror-api',
      testMatch: ['**/mirror-flow.api.spec.ts', '**/mirror-verification.api.spec.ts'],
      use: {
        baseURL: `http://localhost:${API_MIRROR_PORT}`,
        extraHTTPHeaders: {
          'Content-Type': 'application/json',
        },
      },
    },
  ],
});
