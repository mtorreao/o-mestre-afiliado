import { Elysia } from 'elysia';
import { UserRepository, UserCredentialsRepository, MlAffiliateRepository, AffiliatesRepository, MirrorLogRepository } from '@omestre/db';
import type { ExcludedGroup } from '@omestre/db';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
import { convertShopeeUrlWithCredentials, convertAmazonUrlWithTrackingId } from '@omestre/converters';
import type { ShopeeCredentials } from '@omestre/converters';
import { detectMarketplace } from '@omestre/shared';
import type { ConversionResult } from '@omestre/shared';
import { generateViaUrlParams } from '@omestre/converters';
import { instanceNameFromUserId } from '../../services/evolution.ts';
import { fetchGroupMessages } from '../../services/evolution.ts';
import { validateOfferGroups, validateGroup } from '@omestre/shared';
import { replaceSourceGroups, cacheSourceGroup, removeSourceGroup } from '../../services/group-cache.ts';

const userRepo = new UserRepository();
const credentialsRepo = new UserCredentialsRepository();
const mlRepo = new MlAffiliateRepository();
const affiliatesRepo = new AffiliatesRepository();
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

    // Busca configuração de grupos salva (espelhamento)
    const evolutionInstanceId = instanceNameFromUserId(auth.userId);
    const affiliate = await affiliatesRepo.findByEvolutionInstanceId(evolutionInstanceId);

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
        // Grupos de espelhamento configurados
        sourceGroups: affiliate?.sourceGroups || [],
        targetGroups: affiliate?.targetGroups || [],
        // Grupos excluídos por validação (persistentes)
        excludedGroups: (affiliate?.excludedGroups as ExcludedGroup[]) || [],
        // Template personalizado de mensagem
        messageTemplate: affiliate?.messageTemplate || null,
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

    const validation = await validateOfferGroups(instanceName, sourceGroups, fetchGroupMessages);

    // Se a Evolution API está offline, retorna o erro real em vez do genérico
    if (validation.connectionError) {
      return {
        success: false,
        error: `Evolution API offline: ${validation.connectionError}`,
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
    }

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

    const { sourceGroups, targetGroups, messageTemplate } = body as {
      sourceGroups?: { jid: string; name: string }[];
      targetGroups?: { jid: string; name: string }[];
      messageTemplate?: string | null;
    };

    if (!sourceGroups || sourceGroups.length === 0) {
      return { success: false, error: 'Selecione pelo menos 1 grupo de ofertas.' };
    }

    if (sourceGroups.length > 3) {
      return { success: false, error: 'Máximo de 3 grupos de ofertas.' };
    }

    if (!targetGroups || targetGroups.length === 0) {
      return { success: false, error: 'Selecione pelo menos 1 grupo de destino.' };
    }

    const evolutionInstanceId = `user-${auth.userId}`;

    // Busca configuração atual ANTES de salvar (para diff dos sourceGroups)
    const currentAffiliate = await affiliatesRepo.findByEvolutionInstanceId(evolutionInstanceId);
    const oldSourceGroups = (currentAffiliate?.sourceGroups as { jid: string; name: string }[]) ?? [];

    // Validação individual por grupo — grupos que falham são excluídos,
    // mas não bloqueiam a configuração dos que passaram.
    const validation = await validateOfferGroups(evolutionInstanceId, sourceGroups, fetchGroupMessages);

    // Filtra apenas grupos que passaram na validação (≥70% ofertas)
    const passedGroups = sourceGroups.filter((sg) => {
      const result = validation.groups.find((g) => g.groupJid === sg.jid);
      return result?.passed ?? false;
    });

    const failedGroups = validation.groups.filter((g) => !g.passed);

    // Se nenhum grupo passou, aí sim bloqueia o save
    if (passedGroups.length === 0) {
      // Se a Evolution API está offline, retorna o erro real em vez do genérico
      if (validation.connectionError) {
        return {
          success: false,
          error: `Evolution API offline: ${validation.connectionError}`,
          report: {
            overallRatio: validation.overallRatio,
            totalMessages: validation.totalMessages,
            totalValidOffers: validation.totalValidOffers,
            groups: validation.groups.map((g) => ({
              groupJid: g.groupJid,
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

      return {
        success: false,
        error: 'Nenhum dos grupos selecionados passou na validação. Todos precisam ter no mínimo 70% de mensagens com links de marketplaces.',
        report: {
          overallRatio: validation.overallRatio,
          totalMessages: validation.totalMessages,
          totalValidOffers: validation.totalValidOffers,
          groups: validation.groups.map((g) => ({
            groupJid: g.groupJid,
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

    // Constrói lista de grupos excluídos para persistência
    const excludedGroups: ExcludedGroup[] = failedGroups.map((g) => ({
      groupJid: g.groupJid,
      groupName: g.groupName,
      reason: `Apenas ${Math.round(g.ratio * 100)}% de ofertas válidas (mínimo 70%)`,
      ratio: g.ratio,
      totalMessages: g.totalMessages,
      validOffers: g.validOffers,
    }));

    // Preserva excludedGroups de grupos que não estão sendo reconfigurados agora
    const currentExcluded = (currentAffiliate?.excludedGroups ?? []) as ExcludedGroup[];
    const configuredJids = new Set(sourceGroups.map((sg) => sg.jid));
    const preservedExcluded = currentExcluded.filter((eg) => !configuredJids.has(eg.groupJid));
    const mergedExcluded = [...preservedExcluded, ...excludedGroups];

    // Salva apenas os grupos que passaram na validação + excludedGroups persistido + template
    const affiliate = await affiliatesRepo.upsertGroups(evolutionInstanceId, {
      sourceGroups: passedGroups,
      targetGroups: targetGroups,
      excludedGroups: mergedExcluded,
      messageTemplate: messageTemplate ?? undefined,
    });

    // Atualiza o cache Redis apenas com os grupos válidos
    await replaceSourceGroups(
      oldSourceGroups,
      passedGroups,
      affiliate.id,
    );

    // Mensagem adaptativa informando exclusões
    const message =
      failedGroups.length > 0
        ? `Espelhamento configurado com ${passedGroups.length} grupo(s). ${failedGroups.length} grupo(s) foram desativados por não atingirem 70% de ofertas.`
        : 'Espelhamento configurado com sucesso';

    return {
      success: true,
      message,
      affiliateId: affiliate.id,
      sourceGroups: passedGroups,
      targetGroups,
      // Lista de grupos excluídos para a UI mostrar feedback visual fixo
      excludedGroups,
    };
  })

  // ─── POST /api/affiliate/revalidate-group ──────────────────────────
  .post('/api/affiliate/revalidate-group', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { groupJid, groupName } = body as {
      groupJid: string;
      groupName: string;
    };

    if (!groupJid) {
      set.status = 400;
      return { success: false, error: 'groupJid é obrigatório' };
    }

    const evolutionInstanceId = `user-${auth.userId}`;

    // Revalida este grupo específico
    const result = await validateGroup(evolutionInstanceId, groupJid, groupName, fetchGroupMessages, 30);

    if (result.passed) {
      // Grupo passou na revalidação — adiciona aos sourceGroups, remove dos excludedGroups
      const affiliate = await affiliatesRepo.findByEvolutionInstanceId(evolutionInstanceId);
      if (!affiliate) {
        return { success: false, error: 'Afiliado não encontrado' };
      }

      const currentSourceGroups = (affiliate.sourceGroups ?? []) as { jid: string; name: string }[];
      const currentExcluded = (affiliate.excludedGroups ?? []) as ExcludedGroup[];

      const newSourceGroups = [
        ...currentSourceGroups,
        { jid: groupJid, name: groupName },
      ];
      const newExcluded = currentExcluded.filter((eg) => eg.groupJid !== groupJid);

      await affiliatesRepo.upsertGroups(evolutionInstanceId, {
        sourceGroups: newSourceGroups,
        targetGroups: affiliate.targetGroups as { jid: string; name: string }[],
        excludedGroups: newExcluded,
      });

      // Atualiza cache Redis
      await cacheSourceGroup(groupJid, affiliate.id, groupName);

      return {
        success: true,
        passed: true,
        message: 'Grupo revalidado com sucesso e adicionado ao espelhamento.',
        report: {
          groupJid: result.groupJid,
          groupName: result.groupName,
          totalMessages: result.totalMessages,
          validOffers: result.validOffers,
          ratio: result.ratio,
          passed: true,
          errors: result.errors,
        },
      };
    }

    // Ainda não passou — verifica se foi erro de conexão com Evolution API
    // Detecta se o erro é de conexão (Evolution API offline)
    const isConnectionError = result.errors.some((e) =>
      ['evolution api', 'connect', 'econnrefused', 'fetch failed', 'unable to connect', 'enotfound', 'etimedout', 'econnreset', 'erro ao buscar mensagens']
        .some((kw) => e.toLowerCase().includes(kw))
    );

    if (isConnectionError) {
      // Se Evolution API offline, retorna o erro real sem modificar excludedGroups
      const specificError = result.errors.find(
        (e) => !['erro ao buscar mensagens do grupo', 'erro ao buscar mensagens']
          .some((g) => e.toLowerCase().includes(g))
      ) || result.errors[0] || 'Erro de conexão com Evolution API';

      return {
        success: false,
        error: `Evolution API offline: ${specificError}`,
        report: {
          groupJid: result.groupJid,
          groupName: result.groupName,
          totalMessages: result.totalMessages,
          validOffers: result.validOffers,
          ratio: result.ratio,
          passed: false,
          errors: result.errors,
        },
      };
    }

    // Ainda não passou — atualiza a entrada nos excludedGroups com novos dados
    await affiliatesRepo.addExcludedGroup(evolutionInstanceId, {
      groupJid: result.groupJid,
      groupName: result.groupName,
      reason: `Apenas ${Math.round(result.ratio * 100)}% de ofertas válidas (mínimo 70%)`,
      ratio: result.ratio,
      totalMessages: result.totalMessages,
      validOffers: result.validOffers,
    });

    return {
      success: true,
      passed: false,
      message: `Grupo ainda não atingiu o mínimo de 70%. ${Math.round(result.ratio * 100)}% de ofertas válidas.`,
      report: {
        groupJid: result.groupJid,
        groupName: result.groupName,
        totalMessages: result.totalMessages,
        validOffers: result.validOffers,
        ratio: result.ratio,
        passed: false,
        errors: result.errors,
      },
    };
  })

  // ─── POST /api/affiliate/force-group ───────────────────────────────
  .post('/api/affiliate/force-group', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { groupJid, groupName } = body as {
      groupJid: string;
      groupName: string;
    };

    if (!groupJid || !groupName) {
      set.status = 400;
      return { success: false, error: 'groupJid e groupName são obrigatórios' };
    }

    const evolutionInstanceId = `user-${auth.userId}`;
    const affiliate = await affiliatesRepo.findByEvolutionInstanceId(evolutionInstanceId);
    if (!affiliate) {
      return { success: false, error: 'Afiliado não encontrado' };
    }

    const currentSourceGroups = (affiliate.sourceGroups ?? []) as { jid: string; name: string }[];
    const currentExcluded = (affiliate.excludedGroups ?? []) as ExcludedGroup[];

    // Verifica se já está nos sourceGroups
    const alreadyAdded = currentSourceGroups.some((g) => g.jid === groupJid);
    if (alreadyAdded) {
      // Apenas remove dos excluded se ainda estiver lá
      await affiliatesRepo.removeExcludedGroup(evolutionInstanceId, groupJid);
      return {
        success: true,
        message: 'Grupo já está ativo no espelhamento.',
      };
    }

    // Limita a 3 grupos
    if (currentSourceGroups.length >= 3) {
      return {
        success: false,
        error: 'Limite máximo de 3 grupos de ofertas atingido.',
      };
    }

    // Adiciona aos sourceGroups e remove dos excludedGroups
    const newSourceGroups = [
      ...currentSourceGroups,
      { jid: groupJid, name: groupName },
    ];
    const newExcluded = currentExcluded.filter((eg) => eg.groupJid !== groupJid);

    await affiliatesRepo.upsertGroups(evolutionInstanceId, {
      sourceGroups: newSourceGroups,
      targetGroups: affiliate.targetGroups as { jid: string; name: string }[],
      excludedGroups: newExcluded,
    });

    // Atualiza cache Redis
    await cacheSourceGroup(groupJid, affiliate.id, groupName);

    return {
      success: true,
      message: `Grupo "${groupName}" ativado mesmo sem validação. O espelhamento pode não funcionar como esperado.`,
    };
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

  // ─── PUT /api/affiliate/message-template ───────────────────────────
  .put('/api/affiliate/message-template', async ({ jwt, request, set, body }) => {
    const auth = await getAuthUser(jwt, request.headers);
    if (!auth) {
      set.status = 401;
      return { success: false, error: 'Não autenticado' };
    }

    const { messageTemplate } = body as { messageTemplate?: string | null };

    const evolutionInstanceId = `user-${auth.userId}`;
    const result = await affiliatesRepo.updateMessageTemplate(
      evolutionInstanceId,
      messageTemplate ?? null,
    );

    if (!result) {
      set.status = 404;
      return { success: false, error: 'Afiliado não encontrado' };
    }

    return {
      success: true,
      message: 'Template de mensagem atualizado',
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
        marketplace,
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
