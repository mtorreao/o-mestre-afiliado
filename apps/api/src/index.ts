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
import { convertUrl, getAccessToken, generateViaUrlParams, generateShortAffiliateLink } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import { MlAffiliateRepository, UserRepository, UserCredentialsRepository, checkDbHealth } from '@omestre/db';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { affiliateRoutes } from './modules/affiliate/affiliate.routes.ts';
import { whatsAppRoutes } from './modules/whatsapp/whatsapp.routes.ts';
import { webhookRoutes } from './modules/webhook/webhook.routes.ts';
import { warmSourceGroupCache } from './services/group-cache.ts';

const PORT = parseInt(process.env.API_PORT || '5442', 10);
const ML_CLIENT_ID = process.env.ML_CLIENT_ID || '';
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.ML_REDIRECT_URI || 'http://localhost:5442/api/ml/callback';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5441';
const WORKER_METRICS_URL = process.env.WORKER_METRICS_URL || 'http://localhost:9092';

// ─── Repository (banco PostgreSQL via Drizzle) ────────────────────────

const mlRepo = new MlAffiliateRepository();

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
  .use(whatsAppRoutes)
  .use(webhookRoutes)
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

  // ─── ML OAuth — Iniciar fluxo ────────────────────────────────────────
  .get('/api/ml/auth', async ({ query, redirect }) => {
    if (!ML_CLIENT_ID) {
      return { success: false, error: 'ML_CLIENT_ID não configurado no .env' };
    }

    // Se veio da plataforma (usuário logado), passa userId como state
    // para vincular a conta ML após o callback
    const state = (query as { userId?: string }).userId || '';

    const authUrl =
      `https://auth.mercadolivre.com.br/authorization` +
      `?response_type=code` +
      `&client_id=${ML_CLIENT_ID}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      (state ? `&state=${encodeURIComponent(state)}` : '');
    return redirect(authUrl);
  })

  // ─── ML OAuth — Callback ─────────────────────────────────────────────
  .get('/api/ml/callback', async ({ query, set, redirect }) => {
    const { code, error: oauthError } = query as { code?: string; error?: string };

    if (oauthError) {
      set.status = 400;
      return { success: false, error: `Erro na autorização: ${oauthError}` };
    }

    if (!code) {
      set.status = 400;
      return { success: false, error: 'Código de autorização não fornecido' };
    }

    if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
      set.status = 500;
      return { success: false, error: 'Credenciais ML não configuradas no servidor' };
    }

    try {
      const tokenRes = await getAccessToken(ML_CLIENT_ID, ML_CLIENT_SECRET, code, REDIRECT_URI);
      const mlUserId = String((tokenRes as { user_id?: number | string }).user_id ?? '');

      let nickname = mlUserId;
      try {
        const meRes = await fetch('https://api.mercadolibre.com/users/me', {
          headers: { Authorization: `Bearer ${tokenRes.access_token}` },
        });
        if (meRes.ok) {
          const me = (await meRes.json()) as { nickname?: string };
          if (me.nickname) nickname = me.nickname;
        }
      } catch {
        /* fallback: usa mlUserId */
      }

      // Busca dados existentes para preservar meliid/melitat/sessionCookies
      const existing = await mlRepo.findByUserId(mlUserId);

      // Se veio da plataforma (state = userId), vincula ao usuário
      const platformUserId = (query as { state?: string }).state
        ? parseInt((query as { state?: string }).state!, 10)
        : existing?.userId ?? undefined;

      await mlRepo.upsert({
        mlUserId,
        nickname,
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token,
        expiresIn: tokenRes.expires_in,
        connectedAt: existing?.connectedAt,
        userId: platformUserId && !isNaN(platformUserId) ? platformUserId : undefined,
        meliid: existing?.meliid ?? null,
        melitat: existing?.melitat ?? null,
        sessionCookies: existing?.sessionCookies ?? null,
      });

      return redirect(`${FRONTEND_URL}?ml_connected=${mlUserId}`);
    } catch (err) {
      set.status = 500;
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao trocar code por token',
      };
    }
  })

  // ─── ML — Listar afiliados conectados ────────────────────────────────
  .get('/api/ml/affiliates', async () => {
    const affiliates = await mlRepo.findAll();
    return { success: true, affiliates };
  })

  // ─── ML — Atualizar configurações do afiliado ────────────────────────
  .put(
    '/api/ml/affiliates/:mlUserId',
    async ({ params, body, set }) => {
      const { mlUserId } = params as { mlUserId: string };
      const { meliid, melitat, sessionCookies } = body as {
        meliid?: string;
        melitat?: string;
        sessionCookies?: string;
      };

      const updated = await mlRepo.patch(mlUserId, { meliid, melitat, sessionCookies });
      if (!updated) {
        set.status = 404;
        return { success: false, error: 'Afiliado não encontrado' };
      }

      return {
        success: true,
        mlUserId,
        meliid: updated.meliid,
        melitat: updated.melitat,
        hasSessionCookies: !!updated.sessionCookies,
      };
    },
    {
      detail: {
        summary: 'Atualizar configurações do afiliado',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  meliid: { type: 'string' },
                  melitat: { type: 'string' },
                  sessionCookies: { type: 'string', description: 'Cookies de sessão ML (para link curto)' },
                },
              },
            },
          },
        },
      },
    },
  )

  // ─── ML — Converter: tenta link curto, fallback URL params ──────────
  .post(
    '/api/ml/convert',
    async ({ body, set }) => {
      const { url, mlUserId } = body as { url: string; mlUserId?: string };

      if (!url) {
        set.status = 400;
        return { success: false, error: 'URL é obrigatória' };
      }

      if (!mlUserId) {
        set.status = 400;
        return { success: false, error: 'mlUserId é obrigatório' };
      }

      const marketplace = detectMarketplace(url);
      if (marketplace !== 'mercadolivre') {
        set.status = 400;
        return {
          success: false,
          error: 'URL não é do Mercado Livre',
          originalUrl: url,
          marketplace: marketplace as string,
        };
      }

      const affiliate = await mlRepo.findByUserId(mlUserId);

      if (!affiliate) {
        set.status = 404;
        return { success: false, error: `Afiliado ${mlUserId} não encontrado. Conecte-se primeiro.` };
      }

      if (!affiliate.melitat) {
        set.status = 400;
        return {
          success: false,
          error: `Afiliado ${affiliate.nickname} não possui melitat configurado. Configure em "Configurar".`,
        };
      }

      // Atualiza lastUsedAt
      await mlRepo.touch(mlUserId);

      // ── Estratégia 1: Link curto via API interna (se tiver cookies) ──
      if (affiliate.sessionCookies) {
        const shortResult = await generateShortAffiliateLink(
          url,
          affiliate.melitat,
          affiliate.sessionCookies,
        );

        if (shortResult.success && shortResult.shortUrl) {
          return {
            success: true,
            originalUrl: url,
            affiliateUrl: shortResult.shortUrl,
            longUrl: shortResult.longUrl,
            marketplace: 'mercadolivre' as const,
            method: 'api' as const,
            mlUserId,
            nickname: affiliate.nickname,
          };
        }

        // Se falhou por cookie expirado (erro 401/403), tenta URL params
        if (shortResult.error?.includes('HTTP 40') || shortResult.error?.includes('Cookies podem estar expirados')) {
          // Continua pra estratégia 2
        } else {
          // Erro específico (tag inválida, produto inelegível) — retorna
          return {
            success: false,
            originalUrl: url,
            affiliateUrl: null,
            marketplace: 'mercadolivre' as const,
            method: 'unknown' as const,
            error: shortResult.error,
            mlUserId,
            nickname: affiliate.nickname,
          };
        }
      }

      // ── Estratégia 2: URL params (fallback) ──
      try {
        let targetUrl = url;
        if (/meli\.la\//i.test(url)) {
          const resolved = await fetch(url, { method: 'HEAD', redirect: 'manual' });
          const location = resolved.headers.get('location');
          if (location && location !== url) {
            targetUrl = location;
          }
        }

        const affiliateUrl = generateViaUrlParams(targetUrl, {
          meliid: affiliate.meliid ?? undefined,
          melitat: affiliate.melitat,
        });

        return {
          success: true,
          originalUrl: url,
          affiliateUrl,
          marketplace: 'mercadolivre' as const,
          method: 'fallback' as const,
          mlUserId,
          nickname: affiliate.nickname,
        };
      } catch (error) {
        return {
          success: false,
          originalUrl: url,
          affiliateUrl: null,
          marketplace: 'mercadolivre' as const,
          method: 'unknown' as const,
          error: error instanceof Error ? error.message : 'Erro ao gerar link de afiliado',
          mlUserId,
          nickname: affiliate.nickname,
        };
      }
    },
    {
      detail: {
        summary: 'Converter link (multi-afiliado)',
        description: 'Tenta link curto via cookies. Se falhar, usa URL params do afiliado.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  mlUserId: { type: 'string' },
                },
                required: ['url', 'mlUserId'],
              },
            },
          },
        },
      },
    },
  )

  // ─── ML — Refresh manual de um afiliado ─────────────────────────────
  .post('/api/ml/refresh', async ({ body, set }) => {
    const { mlUserId } = body as { mlUserId: string };
    if (!mlUserId) {
      set.status = 400;
      return { success: false, error: 'mlUserId é obrigatório' };
    }

    const affiliate = await mlRepo.findByUserId(mlUserId);
    if (!affiliate) {
      set.status = 404;
      return { success: false, error: 'Afiliado não encontrado' };
    }

    try {
      const refreshed = await getAccessToken(
        ML_CLIENT_ID,
        ML_CLIENT_SECRET,
        undefined,
        undefined,
        affiliate.refreshToken,
      );

      const updated = await mlRepo.refreshTokens(
        mlUserId,
        refreshed.access_token,
        refreshed.refresh_token,
        refreshed.expires_in,
      );

      return { success: true, mlUserId, expiresAt: updated!.expiresAt.toISOString() };
    } catch (err) {
      set.status = 500;
      return { success: false, error: err instanceof Error ? err.message : 'Refresh falhou' };
    }
  })

  // ─── ML — Validar cookies e extrair melitat ──────────────────────────
  .post(
    '/api/ml/affiliates/:mlUserId/validate-cookies',
    async ({ params, set }) => {
      const { mlUserId } = params as { mlUserId: string };
      const affiliate = await mlRepo.findByUserId(mlUserId);

      if (!affiliate) {
        set.status = 404;
        return { success: false, error: 'Afiliado não encontrado' };
      }

      if (!affiliate.sessionCookies) {
        set.status = 400;
        return { success: false, error: 'Nenhum cookie salvo para este afiliado' };
      }

      // Tenta acessar o Link Builder com os cookies
      try {
        const res = await fetch('https://www.mercadolivre.com.br/afiliados/linkbuilder', {
          headers: {
            Cookie: affiliate.sessionCookies,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
          redirect: 'manual',
        });

        const redirected = res.status === 301 || res.status === 302;
        const loginPage = res.headers.get('location')?.includes('login');

        if (redirected && loginPage) {
          return {
            success: false,
            valid: false,
            error: 'Cookies expirados — faça login novamente no ML e reimporte',
          };
        }

        if (!res.ok && res.status !== 200) {
          return {
            success: false,
            valid: false,
            error: `Link Builder retornou HTTP ${res.status}`,
          };
        }

        // Extrair tag_in_use do HTML
        const html = await res.text();
        const tagMatch = html.match(/tag_in_use["']:\s*["']([^"']+)/i);
        let detectedMelitat: string | null = null;

        if (tagMatch?.[1]) {
          detectedMelitat = tagMatch[1];

          // Se o melitat atual está vazio ou diferente, salva automaticamente
          if (!affiliate.melitat || affiliate.melitat !== detectedMelitat) {
            await mlRepo.patch(mlUserId, { melitat: detectedMelitat });
          }
        }

        return {
          success: true,
          valid: true,
          message: 'Cookies válidos! Link curto disponível.',
          melitat: detectedMelitat,
          nickname: affiliate.nickname,
        };
      } catch (err) {
        return {
          success: false,
          valid: false,
          error: err instanceof Error ? err.message : 'Erro ao validar cookies',
        };
      }
    },
  )

  // ─── ML — Remover afiliado ──────────────────────────────────────────
  .delete('/api/ml/affiliates/:mlUserId', async ({ params, set }) => {
    const { mlUserId } = params as { mlUserId: string };
    const deleted = await mlRepo.delete(mlUserId);
    if (!deleted) {
      set.status = 404;
      return { success: false, error: 'Afiliado não encontrado' };
    }
    return { success: true, message: `Afiliado ${mlUserId} removido` };
  })

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
  })

  // ─── Cache warming no startup ─────────────────────────────────────
  .onStart(async () => {
    // Carrega todos os sourceGroups do PostgreSQL para o Redis
    // para evitar que mensagens sejam ignoradas após restart
    await warmSourceGroupCache();
  })

app.listen(PORT);

console.log(`🦊 API rodando em http://localhost:${PORT}`);
console.log(`📖 Swagger docs em http://localhost:${PORT}/docs`);
console.log(`🔗 ML OAuth iniciar: http://localhost:${PORT}/api/ml/auth`);
console.log(`📦 Store: PostgreSQL via Drizzle`);

export type App = typeof app;
