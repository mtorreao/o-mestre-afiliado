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
import { authRoutes } from './modules/auth/auth.routes.ts';
import { affiliateRoutes } from './modules/affiliate/affiliate.routes.ts';
import { mirrorRoutes } from './modules/mirrors/mirrors.routes.ts';
import { whatsAppRoutes } from './modules/whatsapp/whatsapp.routes.ts';
import { webhookRoutes } from './modules/webhook/webhook.routes.ts';
import { mlRoutes } from './modules/ml/ml.routes.ts';

const PORT = parseInt(process.env.API_PORT || '5442', 10);
const WORKER_METRICS_URL = process.env.WORKER_METRICS_URL || 'http://localhost:9092';

// ─── App ─────────────────────────────────────────────────────────────────

const app = new Elysia()
  .use(cors())
  .use(
    swagger({
      path: '/docs',
      documentation: {
        info: {
          title: 'O Mestre Afiliado — API',
          description: 'API para conversão de links de afiliados (Shopee, Mercado Livre)',
          version: '1.0.0',
        },
      },
    }),
  )
  // ─── Error handler global ──────────────────────────────────────────
  .onError(({ code, error, set }) => {
    // Se for erro de banco (timeout, conexão), retorna 503
    const msg = error?.message?.toLowerCase() ?? '';
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
    console.error('[api] Erro não tratado:', error);
    set.status = 500;
    return { success: false, error: 'Erro interno do servidor' };
  })
  .use(authRoutes)
  .use(affiliateRoutes)
  .use(mirrorRoutes)
  .use(whatsAppRoutes)
  .use(webhookRoutes)
  .use(mlRoutes)
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
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string', example: 'https://shopee.com.br/product/123/456' },
                },
                required: ['url'],
              },
            },
          },
        },
      },
    },
  )

  // ─── Worker Status — Proxy para o servidor de métricas do worker ───
  .get('/api/worker/status', async ({ set }) => {
    try {
      const res = await fetch(`${WORKER_METRICS_URL}/status`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        set.status = 502;
        return {
          success: false,
          error: `Worker retornou HTTP ${res.status}`,
          workerStatus: 'unreachable',
        };
      }
      const data = await res.json() as Record<string, unknown>;
      return { success: true, ...data };
    } catch (err) {
      set.status = 503;
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Falha ao contactar worker',
        workerStatus: 'unreachable',
        workerUrl: WORKER_METRICS_URL,
      };
    }
  });

app.listen(PORT);

console.log(`🦊 API rodando em http://localhost:${PORT}`);
console.log(`📖 Swagger docs em http://localhost:${PORT}/docs`);
console.log(`📦 Store: PostgreSQL via Drizzle`);

export type App = typeof app;
