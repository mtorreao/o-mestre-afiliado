/**
 * @omestre/api — Elysia API para conversão de links de afiliados
 *
 * Inclui fluxo OAuth multi-afiliado para Mercado Livre (protótipo).
 * Suporta geração de links curtos (meli.la) via API interna do ML
 * quando cookies de sessão estão configurados.
 *
 * Store de afiliados migrado de JSON file para PostgreSQL via Drizzle ORM.
 */

import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { convertUrl } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import { UserRepository, UserCredentialsRepository, checkDbHealth } from '@omestre/db';
import { config } from './config.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { affiliateRoutes } from './modules/affiliate/affiliate.routes.ts';
import { mirrorRoutes } from './modules/mirrors/mirrors.routes.ts';
import { whatsAppRoutes } from './modules/whatsapp/whatsapp.routes.ts';
import { webhookRoutes } from './modules/webhook/webhook.routes.ts';
import { mlRoutes } from './modules/ml/ml.routes.ts';
import { amazonRoutes } from './modules/amazon/amazon.routes.ts';
import { extensionRoutes } from './modules/extension/extension.routes.ts';
import { featureFlagsRoutes } from './modules/admin/feature-flags.routes.ts';
import { isFeatureEnabled, initFlagInvalidation } from '@omestre/feature-flags';
import { warmSourceGroupCache } from './services/group-cache.ts';
import {
  getAggregatedWorkerStatus,
  listDlqItems,
  requeueDlqItem,
  removeDlqItem,
  purgeDlq,
} from './services/worker-metrics.ts';
import { makeLogger } from '@omestre/shared';

const log = makeLogger('api');
const PORT = parseInt(config.API_PORT, 10);

// ─── App ─────────────────────────────────────────────────────────────────

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'O Mestre Afiliado — API',
          description: 'API para conversão de links de afiliados (Shopee, Mercado Livre, Amazon)',
          version: '1.0.0',
        },
      },
    }),
  )
  // ─── Error handler global ──────────────────────────────────────────
  .onError(({ code, error, set }) => {
    // Se for erro de banco (timeout, conexão), retorna 503
    const msg = error instanceof Error ? error.message.toLowerCase() : '';
    if (
      msg.includes('timeout') ||
      msg.includes('connect') ||
      msg.includes('database') ||
      msg.includes('postgres') ||
      msg.includes('connection') ||
      msg.includes('pool') ||
      msg.includes('select') ||
      msg.includes('relation') ||
      msg.includes('db is')
    ) {
      set.status = 503;
      return {
        success: false,
        error: 'Serviço temporariamente indisponível. O banco de dados pode estar reiniciando.',
      };
    }
    // Erros internos não tratados
    log('error', 'Erro não tratado', { error: String(error) });
    set.status = 500;
    return { success: false, error: 'Erro interno do servidor' };
  })
  .use(authRoutes)
  .use(affiliateRoutes)
  .use(mirrorRoutes)
  .use(whatsAppRoutes)
  .use(webhookRoutes)
  .use(mlRoutes)
  .use(amazonRoutes)
  .use(extensionRoutes)
  .use(featureFlagsRoutes)

  // ─── Gate de manutenção (feature flag global) ────────────────────
  .onBeforeHandle(async ({ request }) => {
    if (await isFeatureEnabled('maintenance_mode')) {
      const path = new URL(request.url).pathname;
      const isExempt =
        path.startsWith('/webhook') ||
        path.startsWith('/api/auth') ||
        path.startsWith('/api/admin') ||
        path === '/health' ||
        path === '/docs' ||
        path.startsWith('/swagger');
      if (!isExempt) {
        const authHeader = request.headers.get('authorization');
        if (authHeader?.startsWith('Bearer ')) {
          // Se tem token, verifica se é admin
          return; // não bloqueia — deixa a rota decidir
        }
        // Sem token → bloqueia
        return {
          success: false,
          error: 'Sistema em manutenção. Tente novamente em instantes.',
          maintenance: true,
        };
      }
    }
  })

  .get('/', () => ({
    service: 'O Mestre Afiliado API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      convert: 'POST /api/convert',
      'ml/auth': 'GET /api/ml/auth',
      'ml/callback': 'GET /api/ml/callback',
      'ml/affiliates': 'GET /api/ml/affiliates',
      'ml/convert': 'POST /api/ml/convert',
      'ml/affiliates/:mlUserId': 'PUT /api/ml/affiliates/:mlUserId',
      'whatsapp/connect': 'POST /api/whatsapp/connect',
      'whatsapp/status': 'GET /api/whatsapp/status',
      'whatsapp/disconnect': 'DELETE /api/whatsapp/disconnect',
      'whatsapp/regenerate-qr': 'POST /api/whatsapp/regenerate-qr',
      'worker/status': 'GET /api/worker/status',
      docs: '/docs',
    },
  }))
  .get('/health', async () => {
    let dbStatus = 'unknown';
    let dbLatency: number | null = null;
    try {
      const result = await checkDbHealth();
      dbStatus = 'connected';
      dbLatency = result.latencyMs;
    } catch (err) {
      dbStatus = 'disconnected';
    }
    return {
      status: 'ok',
      database: dbStatus,
      dbLatencyMs: dbLatency,
      timestamp: new Date().toISOString(),
    };
  })

  // ─── Conversão padrão (usa .env) ─────────────────────────────────────
  .post(
    '/api/convert',
    async ({ body }) => {
      const { url } = body as { url: string };
      if (!url) return { success: false, error: 'URL é obrigatória' };

      const marketplace = detectMarketplace(url);
      if (marketplace === 'unknown') {
        return {
          success: false,
          originalUrl: url,
          error: 'Marketplace não suportado. Aceito: Shopee, Mercado Livre',
        };
      }

      try {
        return await convertUrl(url);
      } catch (error) {
        return {
          success: false,
          originalUrl: url,
          marketplace,
          error: error instanceof Error ? error.message : 'Erro interno',
        };
      }
    },
    {
      detail: {
        summary: 'Converter link de afiliado (padrão)',
        description: 'Converte uma URL usando as credenciais do .env',
      },
    },
  )

  // ─── Worker Status ───────────────────────────────────────────────────
  .get('/api/worker/status', async () => {
    return getAggregatedWorkerStatus();
  })

  // ─── DLQ ─────────────────────────────────────────────────────────────
  .get('/api/worker/dlq', async ({ query }) => {
    const q = query as Record<string, string>;
    return listDlqItems({
      offset: q.offset ? parseInt(q.offset, 10) : 0,
      limit: q.limit ? parseInt(q.limit, 10) : 20,
      queue: q.queue as 'A' | 'B' | undefined,
      failureReason: q.reason || undefined,
      since: q.since ? parseInt(q.since, 10) || undefined : undefined,
    });
  })
  .post('/api/worker/dlq/requeue', async ({ query, set }) => {
    const { id } = query as { id?: string };
    if (!id) {
      set.status = 400;
      return { success: false, error: 'ID é obrigatório' };
    }
    return requeueDlqItem(id);
  })
  .post('/api/worker/dlq/remove', async ({ query, set }) => {
    const { id } = query as { id?: string };
    if (!id) {
      set.status = 400;
      return { success: false, error: 'ID é obrigatório' };
    }
    return removeDlqItem(id);
  })
  .post('/api/worker/dlq/purge', async () => {
    return purgeDlq();
  })

  // ─── Cache warming + flag invalidation no startup ────────────────────
  .onStart(async () => {
    // Assina canal de invalidação de flags (propagação imediata de toggles)
    initFlagInvalidation();

    // Carrega todos os sourceGroups do PostgreSQL para o Redis
    // para evitar que mensagens sejam ignoradas após restart
    await warmSourceGroupCache();
    return { success: true };
  })

  // ─── Start ───────────────────────────────────────────────────────────
  .listen(PORT);

console.log(`🟢 API rodando em http://localhost:${PORT}`);
console.log(`📄 Swagger em http://localhost:${PORT}/docs`);
