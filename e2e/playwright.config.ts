import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const WEB_PORT = process.env.WEB_PORT || '15441';
const API_PORT = process.env.API_PORT || '15442';
const API_MIRROR_PORT = process.env.API_MIRROR_PORT || '15447';
const SIMULATOR_PORT = process.env.SIMULATOR_PORT || '15446';

export default defineConfig({
  testDir: __dirname,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  workers: 1,

  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  projects: [
    {
      name: 'api',
      testMatch: '**/*.api.spec.ts',
    },
    {
      name: 'ui',
      testMatch: '**/*.ui.spec.ts',
      use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      name: 'mirror-api',
      testMatch: '**/mirror-flow.api.spec.ts',
      use: {
        baseURL: `http://localhost:${API_MIRROR_PORT}`,
        extraHTTPHeaders: {
          'Content-Type': 'application/json',
        },
      },
    },
  ],
});
