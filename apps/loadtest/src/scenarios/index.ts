/**
 * scenarios/index.ts — fábricas de cenários de carga para go-live.
 *
 * Cada cenário é construído a partir de config (URL base, apiKey, usuários).
 * Reutiliza os geradores puros de payload de webhook e os novos helpers.
 *
 * FLUXO COMPLETO DO USUÁRIO (cobertura end-to-end):
 *   Etapa 1  onboarding-auth-flow   — registro + login + refresh + /me
 *   Etapa 2  affiliate-crud         — PUT profile + test-conversion + logs
 *   Etapa 3  webhook-ingest-burst   — o hot path (mensagens reais)
 *   Etapa 4  webhook-secondary      — eventos secundários do webhook
 *   Etapa 5  webhook-ignored        — grupos não monitorados (cache negativo)
 *   Etapa 6  webhook-malformed      — payloads quebrados (rejeição graciosa)
 *   Etapa 7  webhook-login-mixed    — mistura webhook + login
 *   Etapa 8  dashboard-reads        — leitura de painel autenticado
 *
 * Rodar tudo:  load/loadtest-control.ts flow
 */

import { buildWebhookBatch } from '../webhook-payload-pure.ts';
import {
  makeEmail,
  makePassword,
  buildAuthRegister,
  buildAuthLogin,
  buildAuthRefresh,
  buildSecondaryWebhookEvent,
  buildAffiliateProfileUpdate,
  buildTestConversionPayload,
  buildMalformedWebhook,
  buildIgnoredWebhook,
} from '../payload-helpers.ts';
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
  /** Etapa do fluxo completo (para o comando flow). */
  flowStage?: number;
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
  // ── Etapa 1: onboarding (register + login + refresh + /me) ──────────────
  {
    name: 'onboarding-auth-flow',
    flowStage: 1,
    build: (ctx) => {
      const requests: ScenarioRequest[] = [];
      const users = ctx.userCount ?? 5;
      // Cada usuário é único (email distinto por user) e tem 1 register + 1
      // login com a MESMA senha — fluxo real de onboarding. Emails únicos
      // evitam a race do unique constraint no register (bug real da API:
      // registros concorrentes do mesmo email viram 500 em vez de 409).
      const password = (u: number) => makePassword(1_000_000 + u);
      const email = (u: number) => makeEmail(u);
      for (let u = 1; u <= users; u++) {
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/auth/register`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: email(u),
            name: `Load Test User ${u}`,
            password: password(u),
          }),
        });
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/auth/login`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email(u), password: password(u) }),
        });
      }
      for (let u = 1; u <= users; u++) {
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/auth/login`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email(u), password: password(u) }),
        });
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/auth/login`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email(u), password: password(u) }),
        });
      }
      for (let i = 0; i < 10; i++) {
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/auth/refresh`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildAuthRefresh(`mock-refresh-${i}`)),
        });
      }
      for (let i = 0; i < 10; i++) {
        requests.push({
          method: 'GET',
          url: `${ctx.baseUrl}/api/auth/me`,
          headers: { Authorization: 'Bearer mock-jwt-token' },
        });
      }
      // bcrypt (10 rounds) é caro: ~100ms/hash com CPU limitado (0.7 vCPU).
      // 4xx (409 email duplicado / 401 login de user já existente) são
      // esperados em rodadas repetidas — o SLO monitora transporte + 5xx.
      const slo: SLO = { maxP95Ms: 3000, maxErrorRate: 0.02, max5xxRate: 0.03 };
      return { name: 'onboarding-auth-flow', requests, concurrency: 20, timeoutMs: 8000, slo };
    },
  },

  // ── Etapa 2: affiliate CRUD (PUT profile + test-conversion + logs) ─────
  {
    name: 'affiliate-crud',
    flowStage: 2,
    build: (ctx) => {
      const token = ctx.authToken ?? 'mock-jwt-token';
      const requests: ScenarioRequest[] = [];
      const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const marketplaces = ['shopee', 'mercadolivre', 'amazon', 'magalu'] as const;
      // 50% PUT profile, 30% test-conversion, 20% mirror-logs
      for (let i = 0; i < 30; i++) {
        requests.push({
          method: 'PUT',
          url: `${ctx.baseUrl}/api/affiliate/profile`,
          headers: auth,
          body: JSON.stringify(buildAffiliateProfileUpdate(30_000 + i)),
        });
      }
      for (let i = 0; i < 18; i++) {
        const m = marketplaces[i % marketplaces.length]!;
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/affiliate/test-conversion`,
          headers: auth,
          body: JSON.stringify(buildTestConversionPayload(m)),
        });
      }
      for (let i = 0; i < 12; i++) {
        requests.push({
          method: 'GET',
          url: `${ctx.baseUrl}/api/affiliate/mirror-logs?page=${(i % 5) + 1}&pageSize=20`,
          headers: auth,
        });
      }
      const slo: SLO = { maxP95Ms: 500, max5xxRate: 0.02 };
      return { name: 'affiliate-crud', requests, concurrency: 10, timeoutMs: 8000, slo };
    },
  },

  // ── Etapa 3: webhook hot path (mensagens reais) ─────────────────────────
  {
    name: 'webhook-ingest-burst',
    flowStage: 3,
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

  // ── Etapa 4: webhook events secundários ─────────────────────────────────
  {
    name: 'webhook-secondary',
    flowStage: 4,
    build: (ctx) => {
      const events = [
        'connection.update',
        'qrcode.updated',
        'groups.upsert',
        'group-participants.update',
      ] as const;
      const requests: ScenarioRequest[] = [];
      for (let i = 0; i < 80; i++) {
        const ev = events[i % events.length]!;
        const instance = `user-${(i % 5) + 1}`;
        const payload = buildSecondaryWebhookEvent(ev, instance, 40_000 + i);
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/webhook/message`,
          headers: { 'Content-Type': 'application/json', apikey: ctx.webhookKey },
          body: JSON.stringify(payload),
        });
      }
      const slo: SLO = { maxP95Ms: 300, maxErrorRate: 0.02 };
      return { name: 'webhook-secondary', requests, concurrency: 15, timeoutMs: 6000, slo };
    },
  },

  // ── Etapa 5: webhook de grupos NÃO monitorados (cache negativo) ────────
  {
    name: 'webhook-ignored',
    flowStage: 5,
    build: (ctx) => {
      const requests: ScenarioRequest[] = [];
      for (let i = 0; i < 100; i++) {
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/webhook/message`,
          headers: { 'Content-Type': 'application/json', apikey: ctx.webhookKey },
          body: JSON.stringify(buildIgnoredWebhook(50_000 + i)),
        });
      }
      const slo: SLO = { maxP95Ms: 400, maxErrorRate: 0.02 };
      return { name: 'webhook-ignored', requests, concurrency: 20, timeoutMs: 6000, slo };
    },
  },

  // ── Etapa 6: webhook malformado (rejeição graciosa) ────────────────────
  {
    name: 'webhook-malformed',
    flowStage: 6,
    build: (ctx) => {
      const requests: ScenarioRequest[] = [];
      for (let i = 0; i < 60; i++) {
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/webhook/message`,
          headers: { 'Content-Type': 'application/json', apikey: ctx.webhookKey },
          body: JSON.stringify(buildMalformedWebhook(60_000 + i)),
        });
      }
      const slo: SLO = { maxP95Ms: 300, max5xxRate: 0.05 };
      return { name: 'webhook-malformed', requests, concurrency: 15, timeoutMs: 6000, slo };
    },
  },

  // ── Etapa 7: mistura webhook + login (tráfego real) ────────────────────
  {
    name: 'webhook-login-mixed',
    flowStage: 7,
    build: (ctx) => {
      const requests: ScenarioRequest[] = [];
      for (let i = 0; i < 70; i++) {
        requests.push(webhookRequest(ctx, (i % 5) + 1, 5000 + i));
      }
      for (let i = 0; i < 30; i++) {
        const u = (i % 5) + 1;
        requests.push({
          method: 'POST',
          url: `${ctx.baseUrl}/api/auth/login`,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: makeEmail(u), password: makePassword(1_000_000 + u) }),
        });
      }
      const slo: SLO = { maxP95Ms: 3000, maxErrorRate: 0.02, max5xxRate: 0.02 };
      return { name: 'webhook-login-mixed', requests, concurrency: 20, timeoutMs: 8000, slo };
    },
  },

  // ── Etapa 8: leituras de painel autenticadas ───────────────────────────
  {
    name: 'dashboard-reads',
    flowStage: 8,
    build: (ctx) => {
      const token = ctx.authToken ?? 'mock-jwt-token';
      const paths = ['/api/mirrors', '/api/auth/me'];
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

/** Cenários ordenados pelo fluxo completo (flowStage asc). */
export function flowScenarios(): ScenarioDef[] {
  return [...SCENARIOS].sort((a, b) => (a.flowStage ?? 99) - (b.flowStage ?? 99));
}
