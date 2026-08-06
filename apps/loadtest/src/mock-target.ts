/**
 * mock-target.ts — servidor alvo simulado para validar a suíte de carga
 * sem subir o stack completo (PG/Redis/Evolution).
 *
 * Emula os endpoints críticos de go-live com fidelidade suficiente para um
 * smoke test da suíte:
 *   POST /webhook/message  (auth via header `apikey` = EVOLUTION_API_KEY)
 *   POST /api/auth/login  (email/senha, sem apikey)
 *   GET  /api/auth/me, /api/mirrors (200)
 *   GET  /health
 * Registra contagens para inspeção.
 */

import { Elysia } from 'elysia';

export interface MockTargetOptions {
  apiKey?: string;
  /** latência base adicionada a cada requisição (ms). */
  latencyMs?: number;
  /** fração 0..1 de requisições que retornam 503. */
  errorRate?: number;
}

export interface MockTargetStats {
  webhooksReceived: number;
  loginsReceived: number;
  rejectedAuth: number;
  dashboardReads: number;
}

export function createMockTarget(opts: MockTargetOptions = {}) {
  const apiKey = opts.apiKey ?? 'test-key';
  const latencyMs = opts.latencyMs ?? 5;
  const errorRate = opts.errorRate ?? 0;
  const stats: MockTargetStats = {
    webhooksReceived: 0,
    loginsReceived: 0,
    rejectedAuth: 0,
    dashboardReads: 0,
  };

  const withLatency = async () => {
    if (latencyMs > 0) await Bun.sleep(latencyMs);
  };

  const app = new Elysia()
    .get('/health', () => ({ status: 'ok' }))
    .post('/webhook/message', async ({ request, set }: any) => {
      const provided = request.headers.get('apikey');
      if (!provided || provided !== apiKey) {
        stats.rejectedAuth += 1;
        set.status = 401;
        return { success: false, error: 'Unauthorized' };
      }
      stats.webhooksReceived += 1;
      await withLatency();
      if (errorRate > 0 && Math.random() < errorRate) {
        set.status = 503;
        return { success: false, error: 'simulated 503' };
      }
      return { success: true };
    })
    .post('/api/auth/login', async ({ request }: any) => {
      stats.loginsReceived += 1;
      await withLatency();
      const body = await request.json().catch(() => ({}));
      if (!body.email || !body.password) {
        return { success: false, error: 'email/senha obrigatórios' };
      }
      return {
        success: true,
        token: 'mock-jwt-token',
        refreshToken: 'mock-refresh',
        user: { id: 1, email: body.email, name: 'Mock', isAdmin: false },
      };
    })
    .get('/api/auth/me', async () => {
      stats.dashboardReads += 1;
      await withLatency();
      return { success: true, user: { id: 1, email: 'mock@example.com', isAdmin: false } };
    })
    .get('/api/mirrors', async () => {
      stats.dashboardReads += 1;
      await withLatency();
      return { success: true, mirrors: [] };
    })
    .get('/__stats', () => stats);

  return { app, stats };
}
