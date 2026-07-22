/**
 * ML Routes — OAuth, convert, refresh, validate-cookies, CRUD de afiliados.
 *
 * Endpoints expostos (mesmos paths do módulo original inline em index.ts):
 *   GET    /api/ml/auth
 *   GET    /api/ml/callback
 *   GET    /api/ml/affiliates
 *   PUT    /api/ml/affiliates/:mlUserId
 *   DELETE /api/ml/affiliates/:mlUserId
 *   POST   /api/ml/affiliates/:mlUserId/validate-cookies
 *   POST   /api/ml/convert
 *   POST   /api/ml/refresh
 */
import { Elysia } from 'elysia';
import {
  getAccessToken,
  generateViaUrlParams,
  generateShortAffiliateLink,
} from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import {
  ML_CLIENT_ID,
  ML_CLIENT_SECRET,
  REDIRECT_URI,
  FRONTEND_URL,
  mlRepo,
  validateCookies,
} from './ml.service.ts';

export const mlRoutes = new Elysia()
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
    const { code, error: oauthError } = query as {
      code?: string;
      error?: string;
    };

    if (oauthError) {
      set.status = 400;
      return { success: false, error: `Erro na autorização: ${oauthError}` };
    }

    if (!code) {
      set.status = 400;
      return {
        success: false,
        error: 'Código de autorização não fornecido',
      };
    }

    if (!ML_CLIENT_ID || !ML_CLIENT_SECRET) {
      set.status = 500;
      return {
        success: false,
        error: 'Credenciais ML não configuradas no servidor',
      };
    }

    try {
      const tokenRes = await getAccessToken(
        ML_CLIENT_ID,
        ML_CLIENT_SECRET,
        code,
        REDIRECT_URI,
      );
      const mlUserId = String(
        (tokenRes as { user_id?: number | string }).user_id ?? '',
      );

      let nickname = mlUserId;
      try {
        const meRes = await fetch(
          'https://api.mercadolibre.com/users/me',
          {
            headers: {
              Authorization: `Bearer ${tokenRes.access_token}`,
            },
          },
        );
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
      const rawState = (query as { state?: string }).state;
      const platformUserId = rawState
        ? parseInt(rawState, 10)
        : existing?.userId ?? undefined;

      await mlRepo.upsert({
        mlUserId,
        nickname,
        accessToken: tokenRes.access_token,
        refreshToken: tokenRes.refresh_token,
        expiresIn: tokenRes.expires_in,
        connectedAt: existing?.connectedAt,
        userId:
          platformUserId && !isNaN(platformUserId)
            ? platformUserId
            : undefined,
        meliid: existing?.meliid ?? null,
        melitat: existing?.melitat ?? null,
        sessionCookies: existing?.sessionCookies ?? null,
      });

      return redirect(`${FRONTEND_URL}?ml_connected=${mlUserId}`);
    } catch (err) {
      set.status = 500;
      return {
        success: false,
        error:
          err instanceof Error ? err.message : 'Erro ao trocar code por token',
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

      const updated = await mlRepo.patch(mlUserId, {
        meliid,
        melitat,
        sessionCookies,
      });
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
                  sessionCookies: {
                    type: 'string',
                    description:
                      'Cookies de sessão ML (para link curto)',
                  },
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
      const { url, mlUserId } = body as {
        url: string;
        mlUserId?: string;
      };

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
        return {
          success: false,
          error: `Afiliado ${mlUserId} não encontrado. Conecte-se primeiro.`,
        };
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
        if (
          shortResult.error?.includes('HTTP 40') ||
          shortResult.error?.includes(
            'Cookies podem estar expirados',
          )
        ) {
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
          const resolved = await fetch(url, {
            method: 'HEAD',
            redirect: 'manual',
          });
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
          error:
            error instanceof Error
              ? error.message
              : 'Erro ao gerar link de afiliado',
          mlUserId,
          nickname: affiliate.nickname,
        };
      }
    },
    {
      detail: {
        summary: 'Converter link (multi-afiliado)',
        description:
          'Tenta link curto via cookies. Se falhar, usa URL params do afiliado.',
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

      return {
        success: true,
        mlUserId,
        expiresAt: updated!.expiresAt.toISOString(),
      };
    } catch (err) {
      set.status = 500;
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Refresh falhou',
      };
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
        return {
          success: false,
          error: 'Nenhum cookie salvo para este afiliado',
        };
      }

      // Usa o helper do service
      const result = await validateCookies(
        affiliate.sessionCookies,
        affiliate.melitat,
        mlUserId,
      );

      return {
        ...result,
        nickname: affiliate.nickname,
      };
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
    return {
      success: true,
      message: `Afiliado ${mlUserId} removido`,
    };
  });
