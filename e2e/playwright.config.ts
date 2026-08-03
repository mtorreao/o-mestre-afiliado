import { defineConfig } from '@playwright/test';

const __dirname = import.meta.dir;
const WEB_PORT = process.env.WEB_PORT || '15441';
const API_PORT = process.env.API_PORT || '15442';
const API_MIRROR_PORT = process.env.API_MIRROR_PORT || '15447';
const SIMULATOR_PORT = process.env.SIMULATOR_PORT || '15446';

// Paralelização por arquivo. Default 2 (validado empiricamente: ~1.83x mais
// rapido que 1 worker; 223 passed em 2.8min vs 5.2min, sem diferenca no resultado).
//
// Isolamento: cada teste opera em seu proprio instanceName (user-{id}, unico
// via uniqueEmail). O simulador escopa por instanceName via query param em
// /__admin/messages e /__admin/reset (apps/whatsapp-simulator/src/index.ts).
// Antes (workers:1): mirror-flow e mirror-pipeline colidiam no sentMessages
// global → flake determinístico. Resolvido pela query ?instanceName=.
//
// Customizacao via env var: E2E_WORKERS=N. Valores invalidos (<1, NaN)
// caem no default. Exemplos:
//   E2E_WORKERS=4 bun run test:e2e   # 4 workers paralelos
//   E2E_WORKERS=1 bun run test:e2e   # serial (debug)
//   bun run test:e2e                 # default 2
function parseWorkers(): number {
  const raw = process.env.E2E_WORKERS;
  if (raw === undefined || raw === '') return 2;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.floor(n);
}
const WORKERS = parseWorkers();

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
