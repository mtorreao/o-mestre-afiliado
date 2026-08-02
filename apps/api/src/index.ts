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
import { magaluRoutes } from './modules/magalu/magalu.routes.ts';
import { extensionRoutes } from './modules/extension/extension.routes.ts';
import { extensionLogRoutes } from './modules/extension/extension-log.routes.ts';
import { featureFlagsRoutes } from './modules/admin/feature-flags.routes.ts';
import { workerAdminRoutes } from './modules/admin/worker-admin.routes.ts';
import { catalogRoutes } from './modules/catalog/catalog.routes.ts';
import { isFeatureEnabled, initFlagInvalidation } from '@omestre/feature-flags';
import { warmSourceGroupCache } from './services/group-cache.ts';
import { globalErrorHandler } from './error-handler.ts';
import { getAllowedCorsOrigins } from './middleware/cors-origins-pure.ts';

const PORT = parseInt(config.API_PORT, 10);

// ─── App ─────────────────────────────────────────────────────────────────

const app = new Elysia().use(
  cors({
    origin: getAllowedCorsOrigins(config.FRONTEND_URL, process.env.NODE_ENV),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);

// ─── Swagger (#8) — só exposto fora de produção ──────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'O Mestre Afiliado — API',
          description:
            'API para conversão de links de afiliados (Shopee, Mercado Livre, Amazon, Magalu)',
          version: '1.0.0',
        },
      },
    }),
  );
}

app
  // ─── Error handler global ──────────────────────────────────────────
  // (VALIDAÇÃO → 400, banco → 503, resto → 500 — ver error-handler.ts)
  .onError(globalErrorHandler)
  .use(authRoutes)
  .use(affiliateRoutes)
  .use(mirrorRoutes)
  .use(whatsAppRoutes)
  .use(webhookRoutes)
  .use(mlRoutes)
  .use(amazonRoutes)
  .use(magaluRoutes)
  .use(extensionRoutes)
  .use(extensionLogRoutes)
  .use(featureFlagsRoutes)
  .use(workerAdminRoutes)
  .use(catalogRoutes)

  // ─── Gate de manutenção (feature flag global) ────────────────────
  .onBeforeHandle(async ({ request, jwt }) => {
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
        // Se tem token, verifica se é admin — só admin bypassa manutenção.
        const authHeader = request.headers.get('authorization');
        if (authHeader?.startsWith('Bearer ')) {
          const token = authHeader.slice(7);
          const payload = (await jwt.verify(token)) as { isAdmin?: boolean } | null | false;
          if (payload && typeof payload === 'object' && payload.isAdmin === true) {
            return; // admin continua navegando durante manutenção
          }
        }
        // Sem token, ou token não-admin → bloqueia
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
if (process.env.NODE_ENV !== 'production') {
  console.log(`📄 Swagger em http://localhost:${PORT}/docs`);
}
