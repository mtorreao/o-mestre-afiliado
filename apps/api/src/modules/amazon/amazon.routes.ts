/**
 * Amazon Routes — CRUD de afiliados Amazon + conversão de links.
 *
 * Endpoints expostos:
 *   GET    /api/amazon/affiliate              — Dados do afiliado do usuário logado
 *   PUT    /api/amazon/affiliate              — Cria/atualiza afiliado (nickname, active)
 *   DELETE /api/amazon/affiliate              — Remove afiliado
 *
 *   GET    /api/amazon/affiliate/tracking-ids — Lista tracking IDs do afiliado
 *   POST   /api/amazon/affiliate/tracking-ids — Adiciona tracking ID
 *   PATCH  /api/amazon/affiliate/tracking-ids/:tag — Edita tracking (label, active, isDefault)
 *   DELETE /api/amazon/affiliate/tracking-ids/:tag — Remove tracking ID
 *
 *   POST   /api/amazon/convert                — Converte URL (usa default ou preferred)
 */
import { Elysia } from 'elysia';
import { convertAmazonUrlWithAffiliate } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { amazonRepo } from './amazon.service.ts';

export const amazonRoutes = new Elysia()
  .use(createJwtPlugin())

  // ─── GET /api/amazon/affiliate ───────────────────────────────────
  .get('/api/amazon/affiliate', async ({ jwt, request, set }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const affiliate = await amazonRepo.findByUserId(auth.userId);
    if (!affiliate) {
      return {
        success: true,
        configured: false,
        affiliate: null,
      };
    }

    return {
      success: true,
      configured: true,
      affiliate: {
        id: affiliate.id,
        nickname: affiliate.nickname,
        trackingIds: affiliate.trackingIds,
        activeTrackingCount: (affiliate.trackingIds ?? []).filter((t) => t.active).length,
        active: affiliate.active,
        connectedAt: affiliate.connectedAt,
        lastUsedAt: affiliate.lastUsedAt,
      },
    };
  })

  // ─── PUT /api/amazon/affiliate ───────────────────────────────────
  .put('/api/amazon/affiliate', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { nickname, active } = body as {
      nickname?: string | null;
      active?: boolean;
    };

    const existing = await amazonRepo.findByUserId(auth.userId);
    const updated = await amazonRepo.upsert(auth.userId, {
      nickname: nickname ?? existing?.nickname ?? null,
      active: active ?? existing?.active ?? true,
      trackingIds: existing?.trackingIds ?? [],
    });

    return {
      success: true,
      message: 'Afiliado Amazon atualizado',
      affiliate: {
        id: updated.id,
        nickname: updated.nickname,
        trackingIds: updated.trackingIds,
        activeTrackingCount: (updated.trackingIds ?? []).filter((t) => t.active).length,
        active: updated.active,
      },
    };
  })

  // ─── DELETE /api/amazon/affiliate ───────────────────────────────────
  .delete('/api/amazon/affiliate', async ({ jwt, request, set }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const deleted = await amazonRepo.delete(auth.userId);
    if (!deleted) {
      set.status = 404;
      return { success: false, error: 'Afiliado Amazon não encontrado' };
    }

    return { success: true, message: 'Afiliado Amazon removido' };
  })

  // ─── GET /api/amazon/affiliate/tracking-ids ──────────────────────────
  .get('/api/amazon/affiliate/tracking-ids', async ({ jwt, request, set }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const affiliate = await amazonRepo.findByUserId(auth.userId);
    if (!affiliate) {
      return { success: true, configured: false, trackingIds: [] };
    }

    return {
      success: true,
      configured: true,
      trackingIds: affiliate.trackingIds ?? [],
    };
  })

  // ─── POST /api/amazon/affiliate/tracking-ids ─────────────────────────
  .post('/api/amazon/affiliate/tracking-ids', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { tag, label, region, active, isDefault } = body as {
      tag?: string;
      label?: string;
      region?: 'BR' | 'US' | 'CA' | 'MX' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES' | 'JP' | 'AU' | 'OTHER';
      active?: boolean;
      isDefault?: boolean;
    };

    if (!tag || tag.trim() === '') {
      set.status = 400;
      return { success: false, error: 'tag é obrigatório' };
    }

    // Cria afiliado se não existir (primeiro tracking ID)
    const existing = await amazonRepo.findByUserId(auth.userId);
    if (!existing) {
      await amazonRepo.upsert(auth.userId, {
        nickname: null,
        active: true,
        trackingIds: [],
      });
    }

    try {
      const updated = await amazonRepo.addTrackingId(auth.userId, {
        tag: tag.trim(),
        label: label?.trim() || undefined,
        region: region ?? undefined,
        active: active ?? true,
        isDefault: isDefault ?? undefined,
      });

      if (!updated) {
        set.status = 500;
        return { success: false, error: 'Falha ao adicionar tracking ID' };
      }

      return {
        success: true,
        message: 'Tracking ID adicionado',
        trackingIds: updated.trackingIds,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao adicionar tracking ID';
      set.status = 400;
      return { success: false, error: msg };
    }
  })

  // ─── PATCH /api/amazon/affiliate/tracking-ids/:tag ───────────────────
  .patch(
    '/api/amazon/affiliate/tracking-ids/:tag',
    async ({ jwt, request, set, params, body }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const { tag } = params as { tag: string };
      const { label, region, active, isDefault } = body as {
        label?: string | null;
        region?: 'BR' | 'US' | 'CA' | 'MX' | 'UK' | 'DE' | 'FR' | 'IT' | 'ES' | 'JP' | 'AU' | 'OTHER';
        active?: boolean;
        isDefault?: boolean;
      };

      const updated = await amazonRepo.updateTrackingId(auth.userId, decodeURIComponent(tag), {
        label: label ?? undefined,
        region: region ?? undefined,
        active: active ?? undefined,
        isDefault: isDefault ?? undefined,
      });

      if (!updated) {
        set.status = 404;
        return { success: false, error: 'Tracking ID não encontrado' };
      }

      return {
        success: true,
        message: 'Tracking ID atualizado',
        trackingIds: updated.trackingIds,
      };
    },
  )

  // ─── DELETE /api/amazon/affiliate/tracking-ids/:tag ──────────────────
  .delete(
    '/api/amazon/affiliate/tracking-ids/:tag',
    async ({ jwt, request, set, params }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const { tag } = params as { tag: string };
      const updated = await amazonRepo.removeTrackingId(auth.userId, decodeURIComponent(tag));
      if (!updated) {
        set.status = 404;
        return { success: false, error: 'Tracking ID não encontrado' };
      }

      return {
        success: true,
        message: 'Tracking ID removido',
        trackingIds: updated.trackingIds,
      };
    },
  )

  // ─── POST /api/amazon/convert ─────────────────────────────────────
  .post(
    '/api/amazon/convert',
    async ({ jwt, request, set, body }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const { url, tag: preferredTag } = body as {
        url?: string;
        tag?: string;
      };

      if (!url) {
        set.status = 400;
        return { success: false, error: 'URL é obrigatória' };
      }

      const marketplace = detectMarketplace(url);
      if (marketplace !== 'amazon') {
        set.status = 400;
        return {
          success: false,
          error: 'URL não é da Amazon',
          originalUrl: url,
          marketplace,
        };
      }

      const affiliate = await amazonRepo.findByUserId(auth.userId);
      if (!affiliate) {
        set.status = 404;
        return {
          success: false,
          error: 'Afiliado Amazon não configurado. Cadastre seu tracking ID no painel.',
          originalUrl: url,
        };
      }

      const result = await convertAmazonUrlWithAffiliate(
        url,
        affiliate.trackingIds ?? [],
        { preferredTag: preferredTag ?? null },
      );

      // Touch (atualiza lastUsedAt) em caso de sucesso
      if (result.success) {
        await amazonRepo.touch(auth.userId);
      }

      return result;
    },
    {
      detail: {
        summary: 'Converter URL Amazon (multi-afiliado)',
        description:
          'Converte uma URL usando o tracking ID do afiliado. Se `tag` for fornecido, usa esse específico; senão, usa o `isDefault: true` (ou o primeiro ativo).',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  tag: { type: 'string', description: 'Tracking ID específico (opcional)' },
                },
                required: ['url'],
              },
            },
          },
        },
      },
    },
  );
