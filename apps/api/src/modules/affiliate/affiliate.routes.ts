import { Elysia } from 'elysia';
import { UserRepository, UserCredentialsRepository, MlAffiliateRepository, MirrorLogRepository } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { convertShopeeUrlWithCredentials, convertAmazonUrlWithTrackingId } from '@omestre/converters';
import type { ShopeeCredentials } from '@omestre/converters';
import { detectMarketplace, resolvePlaceholders, processConditionalsHuman, buildEvalContext, findUnknownPlaceholders } from '@omestre/shared';
import type { ConversionResult, TemplateContext } from '@omestre/shared';
import { generateViaUrlParams } from '@omestre/converters';
import { instanceNameFromUserId } from '../../services/evolution.ts';
import { fetchGroupMessages } from '../../services/evolution.ts';

const userRepo = new UserRepository();
const credentialsRepo = new UserCredentialsRepository();
const mlRepo = new MlAffiliateRepository();
const mirrorLogRepo = new MirrorLogRepository();

export const affiliateRoutes = new Elysia()
  .use(createJwtPlugin())

  // ─── GET /api/affiliate/profile ───────────────────────────────────
  .get('/api/affiliate/profile', async ({ jwt, request, set }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const user = await userRepo.findPublicById(auth.userId);
    if (!user) {
      return { success: false, error: 'Usuário não encontrado' };
    }

    const creds = await credentialsRepo.findByUserId(auth.userId);
    const mlAffiliate = await mlRepo.findByPlatformUserId(auth.userId);

    const mlInfo = mlAffiliate
      ? {
          connected: true,
          nickname: mlAffiliate.nickname,
          mlUserId: mlAffiliate.mlUserId,
          expired: mlAffiliate.expiresAt < new Date(),
          hasSessionCookies: !!mlAffiliate.sessionCookies,
          meliid: mlAffiliate.meliid,
          melitat: mlAffiliate.melitat,
        }
      : { connected: false };

    return {
      success: true,
      profile: {
        id: user.id,
        email: user.email,
        name: user.name,
        shopeeConfigured: !!(creds?.shopeeAppId),
        shopeeAppId: creds?.shopeeAppId || null,
        amazonConfigured: !!(creds?.amazonTrackingId),
        amazonTrackingId: creds?.amazonTrackingId || null,
        mercadoLivre: mlInfo,
        // Configuração de notificações proativas
        notificationConfig: {
          channel: null,
          jid: null,
        },
      },
    };
  })

  // ─── PUT /api/affiliate/profile ───────────────────────────────────
  .put('/api/affiliate/profile', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { shopeeAppId, shopeeAppSecret, amazonTrackingId } = body as {
      shopeeAppId?: string;
      shopeeAppSecret?: string;
      amazonTrackingId?: string;
    };

    await credentialsRepo.upsert(auth.userId, {
      shopeeAppId: shopeeAppId ?? undefined,
      shopeeAppSecret: shopeeAppSecret ?? undefined,
      amazonTrackingId: amazonTrackingId ?? undefined,
    });

    return { success: true, message: 'Perfil atualizado' };
  })

  // ─── POST /api/affiliate/test-conversion ──────────────────────────
  .post('/api/affiliate/test-conversion', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { url, platform } = body as { url: string; platform?: string };
    if (!url) {
      set.status = 400;
      return { success: false, error: 'URL é obrigatória' };
    }

    // Usa a plataforma fornecida ou detecta automaticamente
    const marketplace = platform && ['shopee', 'mercadolivre', 'amazon'].includes(platform)
      ? platform
      : detectMarketplace(url);

    if (marketplace === 'shopee') {
      return handleShopeeConversion(auth.userId, url);
    }

    if (marketplace === 'mercadolivre') {
      return handleMlConversion(auth.userId, url);
    }

    if (marketplace === 'amazon') {
      return handleAmazonConversion(auth.userId, url);
    }

    set.status = 400;
    return {
      success: false,
      originalUrl: url,
      error: 'Marketplace não suportado. Aceito: Shopee, Mercado Livre, Amazon',
    };
  })

  // ─── GET /api/affiliate/mirror-logs ─────────────────────────────────
  .get('/api/affiliate/mirror-logs', async ({ jwt, request, set, query }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const {
      sourceGroupJid,
      targetGroupJid,
      status,
      marketplace,
      dateFrom,
      dateTo,
      search,
      page,
      pageSize,
    } = query as Record<string, string | undefined>;

    try {
      const result = await mirrorLogRepo.list({
        sourceGroupJid,
        targetGroupJid,
        status: (status as 'sent' | 'failed' | 'blocked' | undefined),
        marketplace: (marketplace as 'shopee' | 'mercadolivre' | 'amazon' | 'unknown' | undefined),
        dateFrom,
        dateTo,
        search,
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      });
      return { success: true, ...result };
    } catch (err) {
      set.status = 500;
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Erro ao buscar logs',
      };
    }
  })

  // ─── POST /api/affiliate/preview-template ──────────────────────────
  .post('/api/affiliate/preview-template', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const {
      template,
      testUrl,
      convertedUrl,
      marketplace,
      sourceGroupName,
      targetGroupName,
    } = body as {
      template?: string;
      testUrl?: string;
      convertedUrl?: string | null;
      marketplace?: string;
      sourceGroupName?: string;
      targetGroupName?: string;
    };

    if (!template) {
      set.status = 400;
      return { success: false, error: 'template é obrigatório' };
    }

    const mp = marketplace || 'unknown';
    const ctx: TemplateContext = {
      originalText: testUrl || 'URL de teste: https://exemplo.com/produto',
      originalUrl: testUrl || 'https://exemplo.com/produto',
      convertedUrl: convertedUrl ?? null,
      marketplace: mp,
      sourceGroupName: sourceGroupName || 'Grupo de Origem',
      targetGroupName: targetGroupName || 'Grupo de Destino',
      timestamp: new Date(),
    };

    // 1. Processa condicionais
    const evalCtx = buildEvalContext(mp, ctx.sourceGroupName, ctx.targetGroupName);
    let preview = processConditionalsHuman(template, evalCtx);

    // 2. Resolve placeholders
    preview = resolvePlaceholders(preview, ctx);

    // 3. Detecta placeholders desconhecidos
    const unknownPlaceholders = findUnknownPlaceholders(template);

    return {
      success: true,
      preview,
      unknownPlaceholders,
      isEmpty: preview.trim().length === 0,
      length: preview.length,
    };
  })

  // ─── POST /api/affiliate/validate-template ──────────────────────────
  .post('/api/affiliate/validate-template', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { template } = body as { template?: string };

    if (template === undefined) {
      set.status = 400;
      return { success: false, error: 'template é obrigatório' };
    }

    const unknownPlaceholders = findUnknownPlaceholders(template || '');

    // Verifica se contém condicionais (técnica ou humanizada)
    const containsConditional = /\{\?|\{\/\}|\{\:|\{se\s|\{senão|\{fim\}/i.test(template || '');

    // Verifica se contém pelo menos um placeholder de texto ou link
    const containsLinkOrText = /\{texto_original\}|\{link_convertido\}/i.test(template || '');

    // Verifica placeholders condicionais inválidos
    const conditionalErrors: string[] = [];
    if (containsConditional) {
      // Verifica se há {? sem {/} correspondente (sintaxe técnica)
      const openCount = (template!.match(/\{\?/g) || []).length;
      const closeCount = (template!.match(/\{\//g) || []).length;
      if (openCount !== closeCount) {
        conditionalErrors.push(
          `Blocos condicionais desbalanceados: ${openCount} abertos ({?}), ${closeCount} fechados ({/})`,
        );
      }
      // Verifica se há {se sem {fim} correspondente (sintaxe humanizada)
      const humanOpenCount = (template!.match(/\{se\s/gi) || []).length;
      const humanCloseCount = (template!.match(/\{fim\}/gi) || []).length;
      if (humanOpenCount !== humanCloseCount) {
        conditionalErrors.push(
          `Blocos condicionais desbalanceados: ${humanOpenCount} abertos ({se}), ${humanCloseCount} fechados ({fim})`,
        );
      }
    }

    return {
      success: true,
      valid: unknownPlaceholders.length === 0 && conditionalErrors.length === 0,
      unknownPlaceholders,
      containsConditional,
      containsLinkOrText,
      conditionalErrors,
    };
  });
async function handleShopeeConversion(
  userId: number,
  url: string,
): Promise<ConversionResult> {
  const creds = await credentialsRepo.findByUserId(userId);

  if (!creds?.shopeeAppId || !creds?.shopeeAppSecret) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'shopee',
      method: 'unknown',
      error: 'Credenciais Shopee não configuradas. Configure App ID e Secret no perfil.',
    };
  }

  return convertShopeeUrlWithCredentials(url, {
    appId: creds.shopeeAppId,
    secret: creds.shopeeAppSecret,
  });
}

/**
 * Converte URL do Mercado Livre usando o afiliado vinculado ao usuário.
 */
async function handleMlConversion(
  userId: number,
  url: string,
): Promise<ConversionResult> {
  const mlAffiliate = await mlRepo.findByPlatformUserId(userId);

  if (!mlAffiliate) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'mercadolivre',
      method: 'unknown',
      error: 'Nenhuma conta Mercado Livre vinculada. Conecte-se primeiro.',
    };
  }

  if (!mlAffiliate.melitat) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'mercadolivre',
      method: 'unknown',
      error: 'Afiliado sem melitat configurado.',
    };
  }

  const affiliateUrl = generateViaUrlParams(url, {
    meliid: mlAffiliate.meliid ?? undefined,
    melitat: mlAffiliate.melitat,
  });

  return {
    success: true,
    originalUrl: url,
    affiliateUrl,
    marketplace: 'mercadolivre',
    method: 'fallback',
  };
}

/**
 * Converte URL da Amazon usando o tracking ID do usuário.
 */
async function handleAmazonConversion(
  userId: number,
  url: string,
): Promise<ConversionResult> {
  const creds = await credentialsRepo.findByUserId(userId);

  if (!creds?.amazonTrackingId) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'amazon',
      method: 'unknown',
      error: 'Amazon tracking ID não configurado. Configure no perfil.',
    };
  }

  return convertAmazonUrlWithTrackingId(url, creds.amazonTrackingId);
}
