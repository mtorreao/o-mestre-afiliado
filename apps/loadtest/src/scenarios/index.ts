/**
 * scenarios/index.ts — fábricas de cenários de carga para go-live.
 *
 * Cada cenário é construído a partir de config (URL base, apiKey, usuários).
 * Reutiliza os geradores puros de payload de webhook.
 */

import { buildWebhookBatch } from '../webhook-payload-pure.ts';
import type { ScenarioConfig, ScenarioRequest } from '../scenario.ts';
import type { SLO } from '../metrics-pure.ts';

export interface ScenarioContext {
  /** URL base da API (ex: http://localhost:5442). */
  baseUrl: string;
  /** apikey do webhook (EVOLUTION_API_KEY). */
  webhookKey: string;
  /** token de auth (Bearer) para rotas autenticadas. */
  authToken?: string;
  /** número de instâncias/usuários distintos a simular. */
  userCount?: number;
}

export interface ScenarioDef {
  name: string;
  build: (ctx: ScenarioContext) => ScenarioConfig;
}

function webhookRequest(ctx: ScenarioContext, userId: number, seed: number): ScenarioRequest {
  const events = buildWebhookBatch(1, { userId, seed });
  const event = events[0]!;
  return {
    method: 'POST',
    url: `${ctx.baseUrl}/webhook/message`,
    headers: { 'Content-Type': 'application/json', apikey: ctx.webhookKey },
    body: JSON.stringify(event),
  };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    name: 'webhook-ingest-burst',
    build: (ctx) => {
      const users = ctx.userCount ?? 5;
      const perUser = 40;
      const requests: ScenarioRequest[] = [];
      for (let u = 0; u < users; u++) {
        for (let i = 0; i < perUser; i++) {
          requests.push(webhookRequest(ctx, u + 1, u * 1000 + i));
        }
      }
      const slo: SLO = {
        maxP95Ms: 500,
        maxP99Ms: 1000,
        maxErrorRate: 0.02,
        max5xxRate: 0.01,
        minRps: 50,
      };
      return { name: 'webhook-ingest-burst', requests, concurrency: 25, timeoutMs: 8000, slo };
    },
  },
  {
    name: 'webhook-login-mixed',
    build: (ctx) => {
      const requests: ScenarioRequest[] = [];
      // 70% webhook, 30% login
      for (let i = 0; i < 70; i++) {
        requests.push(webhookRequest(ctx, (i % 5) + 1, 5000 + i));
      }
      for (let i = 0; i < 30; i++) {
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/auth/login`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'mock@example.com', password: 'Test@123456' }),
        });
      }
      const slo: SLO = { maxP95Ms: 600, maxErrorRate: 0.02 };
      return { name: 'webhook-login-mixed', requests, concurrency: 20, timeoutMs: 8000, slo };
    },
  },
  {
    name: 'dashboard-reads',
    build: (ctx) => {
      const token = ctx.authToken ?? 'mock-jwt-token';
      const paths = ['/api/worker/status', '/api/mirrors', '/api/auth/me'];
      const requests: ScenarioRequest[] = [];
      for (let i = 0; i < 60; i++) {
        const path = paths[i % paths.length]!;
        requests.push({
          method: 'GET',
          url: `${ctx.baseUrl}${path}`,
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      const slo: SLO = { maxP95Ms: 300, max5xxRate: 0.01 };
      return { name: 'dashboard-reads', requests, concurrency: 15, timeoutMs: 6000, slo };
    },
  },
];

export function getScenario(name: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.name === name);
}
