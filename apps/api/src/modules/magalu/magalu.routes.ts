/**
 * Magalu Routes — CRUD de afiliados Magalu (Influenciador Magalu) + conversão.
 *
 * Endpoints expostos:
 *   GET    /api/magalu/affiliate              — Dados do afiliado do usuário logado
 *   PUT    /api/magalu/affiliate              — Atualiza nickname / storeSlug / active
 *   DELETE /api/magalu/affiliate              — Remove afiliado
 *
 *   POST   /api/magalu/convert                — Converte URL usando o storeSlug do afiliado
 *
 *   GET    /api/magalu/affiliate/validate-slug?slug=X — HEAD opcional em
 *          magazinevoce.com.br/{X}/ → { exists: boolean }. Em dev (ou se a
 *          validação falhar/timeout), retorna `exists: null` (sem validação).
 */
import { Elysia } from 'elysia';
import { convertMagaluUrlWithStoreSlug, validateMagaluStoreSlugPure } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { magaluRepo } from './magalu.service.ts';

/** Timeout curto para o HEAD de validação do slug (evita travar a request). */
const SLUG_VALIDATION_TIMEOUT_MS = 5_000;

/**
 * Valida o slug da loja no Magazine Você (regex ^[a-z0-9-]{3,40}$).
 * Retorna a mensagem de erro ou null quando válido.
 */
function slugErrorOrNull(slug: string | undefined): string | null {
  const validation = validateMagaluStoreSlugPure(slug);
  if (validation.valid) return null;
  return validation.reason ?? 'slug inválido';
}

/**
 * HEAD opcional em magazinevoce.com.br/{slug}/ para conferir se a loja existe.
 * Falha/timeout/erro de rede → `exists: null` (sem validação — comportamento dev).
 */
async function checkSlugExists(slug: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://www.magazinevoce.com.br/${slug}/`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(SLUG_VALIDATION_TIMEOUT_MS),
    });
    if (res.status >= 200 && res.status < 400) return true;
    if (res.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}

export const magaluRoutes = new Elysia()
  .use(createJwtPlugin())

  // ─── GET /api/magalu/affiliate ───────────────────────────────────
  .get('/api/magalu/affiliate', async ({ jwt, request, set }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const affiliate = await magaluRepo.findByUserId(auth.userId);
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
        storeSlug: affiliate.storeSlug,
        active: affiliate.active,
        connectedAt: affiliate.connectedAt,
        lastUsedAt: affiliate.lastUsedAt,
      },
    };
  })

  // ─── PUT /api/magalu/affiliate ───────────────────────────────────
  .put('/api/magalu/affiliate', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { nickname, storeSlug, active } = body as {
      nickname?: string;
      storeSlug?: string;
      active?: boolean;
    };

    // Slug é obrigatório no cadastro e sempre validado quando informado
    const existing = await magaluRepo.findByUserId(auth.userId);
    const finalSlug = storeSlug ?? existing?.storeSlug;

    const slugError = slugErrorOrNull(finalSlug);
    if (slugError) {
      set.status = 400;
      return {
        success: false,
        error: `Slug da loja inválido: ${slugError}. Use 3-40 caracteres (letras minúsculas, números e hífen).`,
      };
    }

    const updated = await magaluRepo.upsert(auth.userId, {
      nickname: nickname ?? undefined,
      storeSlug: finalSlug as string,
      active: active ?? existing?.active ?? true,
    });

    return {
      success: true,
      message: 'Integração Magalu atualizada',
      affiliate: {
        id: updated.id,
        nickname: updated.nickname,
        storeSlug: updated.storeSlug,
        active: updated.active,
      },
    };
  })

  // ─── DELETE /api/magalu/affiliate ───────────────────────────────────
  .delete('/api/magalu/affiliate', async ({ jwt, request, set }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const deleted = await magaluRepo.delete(auth.userId);
    if (!deleted) {
      set.status = 404;
      return { success: false, error: 'Afiliado Magalu não encontrado' };
    }

    return { success: true, message: 'Afiliado Magalu removido' };
  })

  // ─── GET /api/magalu/affiliate/validate-slug ─────────────────────────
  .get('/api/magalu/affiliate/validate-slug', async ({ jwt, request, set, query }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { slug } = query as { slug?: string };
    const slugError = slugErrorOrNull(slug);
    if (slugError) {
      set.status = 400;
      return {
        success: false,
        error: `Slug inválido: ${slugError}. Use 3-40 caracteres (letras minúsculas, números e hífen).`,
      };
    }

    const exists = await checkSlugExists(slug as string);

    return {
      success: true,
      slug,
      exists,
      note: exists === null ? 'Validação indisponível (sem checagem de rede)' : undefined,
    };
  })

  // ─── POST /api/magalu/convert ─────────────────────────────────────
  .post(
    '/api/magalu/convert',
    async ({ jwt, request, set, body }) => {
      const auth = await getAuthUser(jwt, request.headers);
      if (!auth) {
        set.status = 401;
        return { success: false, error: 'Não autenticado' };
      }

      const { url } = body as { url?: string };

      if (!url) {
        set.status = 400;
        return { success: false, error: 'URL é obrigatória' };
      }

      const marketplace = detectMarketplace(url);
      if (marketplace !== 'magalu') {
        set.status = 400;
        return {
          success: false,
          error: 'URL não é da Magalu',
          originalUrl: url,
          marketplace,
        };
      }

      const affiliate = await magaluRepo.findByUserId(auth.userId);
      if (!affiliate || !affiliate.active) {
        set.status = 404;
        return {
          success: false,
          error:
            'Afiliado Magalu não configurado. Cadastre seu slug da loja no painel (Configurações → Magalu).',
          originalUrl: url,
        };
      }

      const result = await convertMagaluUrlWithStoreSlug(url, affiliate.storeSlug);

      // Touch (atualiza lastUsedAt) em caso de sucesso
      if (result.success) {
        await magaluRepo.touch(auth.userId);
      }

      return result;
    },
    {
      detail: {
        summary: 'Converter URL Magalu',
        description:
          'Converte uma URL da Magalu (magazineluiza.com.br, maga.lu, magazinevoce.com.br) usando o storeSlug do afiliado logado.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                },
                required: ['url'],
              },
            },
          },
        },
      },
    },
  );
