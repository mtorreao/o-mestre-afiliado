import { Elysia } from 'elysia';
import { UserRepository, UserCredentialsRepository, MlAffiliateRepository, AffiliatesRepository } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { convertShopeeUrlWithCredentials } from '@omestre/converters';
import type { ShopeeCredentials } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import type { ConversionResult } from '@omestre/shared';
import { generateViaUrlParams } from '@omestre/converters';
import { instanceNameFromUserId } from '../../services/evolution.ts';
import { validateOfferGroups } from '../../services/offerValidator.ts';

const userRepo = new UserRepository();
const credentialsRepo = new UserCredentialsRepository();
const mlRepo = new MlAffiliateRepository();
const affiliatesRepo = new AffiliatesRepository();

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
        mercadoLivre: mlInfo,
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

    const { shopeeAppId, shopeeAppSecret } = body as {
      shopeeAppId?: string;
      shopeeAppSecret?: string;
    };

    await credentialsRepo.upsert(auth.userId, {
      shopeeAppId: shopeeAppId ?? undefined,
      shopeeAppSecret: shopeeAppSecret ?? undefined,
    });

    return { success: true, message: 'Credenciais salvas' };
  })

  // ─── POST /api/affiliate/validate-groups ──────────────────────────
  .post('/api/affiliate/validate-groups', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { sourceGroups } = body as {
      sourceGroups?: { jid: string; name: string }[];
    };

    if (!sourceGroups || sourceGroups.length === 0) {
      return { success: false, error: 'Selecione pelo menos 1 grupo de ofertas.' };
    }

    if (sourceGroups.length > 3) {
      return { success: false, error: 'Máximo de 3 grupos de ofertas.' };
    }

    const instanceName = instanceNameFromUserId(auth.userId);

    const validation = await validateOfferGroups(instanceName, sourceGroups);

    return {
      success: true,
      validated: validation.overallPassed,
      report: {
        overallRatio: validation.overallRatio,
        totalMessages: validation.totalMessages,
        totalValidOffers: validation.totalValidOffers,
        groups: validation.groups.map((g) => ({
          groupJid: g.groupJid,
          groupName: g.groupName,
          totalMessages: g.totalMessages,
          validOffers: g.validOffers,
          invalidMessages: g.invalidMessages,
          ratio: g.ratio,
          passed: g.passed,
          errors: g.errors,
        })),
      },
    };
  })

  // ─── POST /api/affiliate/groups-config ──────────────────────────
  .post('/api/affiliate/groups-config', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { sourceGroups, targetGroup } = body as {
      sourceGroups?: { jid: string; name: string }[];
      targetGroup?: { jid: string; name: string };
    };

    // Validações
    if (!sourceGroups || sourceGroups.length === 0) {
      return { success: false, error: 'Selecione pelo menos 1 grupo de ofertas.' };
    }

    if (sourceGroups.length > 3) {
      return { success: false, error: 'Máximo de 3 grupos de ofertas.' };
    }

    if (!targetGroup || !targetGroup.jid) {
      return { success: false, error: 'Selecione exatamente 1 grupo de destino.' };
    }

    const evolutionInstanceId = `user-${auth.userId}`;

    // Validação das últimas 30 mensagens antes de salvar
    const validation = await validateOfferGroups(evolutionInstanceId, sourceGroups);
    if (!validation.overallPassed) {
      return {
        success: false,
        error: `Validação de ofertas falhou: ${validation.totalValidOffers}/${validation.totalMessages} mensagens contêm links de marketplaces válidos (mínimo 70%). Verifique os grupos selecionados.`,
        report: {
          overallRatio: validation.overallRatio,
          totalMessages: validation.totalMessages,
          totalValidOffers: validation.totalValidOffers,
          groups: validation.groups.map((g) => ({
            groupName: g.groupName,
            totalMessages: g.totalMessages,
            validOffers: g.validOffers,
            ratio: g.ratio,
            passed: g.passed,
            errors: g.errors,
          })),
        },
      };
    }

    const affiliate = await affiliatesRepo.upsertGroups(evolutionInstanceId, {
      sourceGroups,
      targetGroups: [targetGroup],
    });

    return {
      success: true,
      message: 'Espelhamento configurado com sucesso',
      affiliateId: affiliate.id,
      sourceGroups,
      targetGroup,
    };
  })

  // ─── POST /api/affiliate/test-conversion ──────────────────────────
  .post('/api/affiliate/test-conversion', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { url } = body as { url: string };
    if (!url) {
      set.status = 400;
      return { success: false, error: 'URL é obrigatória' };
    }

    const marketplace = detectMarketplace(url);

    if (marketplace === 'shopee') {
      return handleShopeeConversion(auth.userId, url);
    }

    if (marketplace === 'mercadolivre') {
      return handleMlConversion(auth.userId, url);
    }

    set.status = 400;
    return {
      success: false,
      originalUrl: url,
      error: 'Marketplace não suportado. Aceito: Shopee, Mercado Livre',
    };
  });

/**
 * Converte URL da Shopee usando as credenciais do usuário.
 */
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
