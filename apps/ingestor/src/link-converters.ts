/**
 * Conversão de URLs de oferta em links de afiliado por marketplace.
 *
 * Cada marketplace tem seu próprio sub-converter que resolve credenciais
 * do afiliado (userId → repo) e usa a função de conversão apropriada do
 * @omestre/converters. Cache de conversões recentes via Redis (1h TTL).
 *
 * Estratégia de fallback:
 *  - Shopee: se afiliado tem credenciais próprias → usa. Senão, fallback
 *    global (env SHOPEE_APP_ID/SECRET) + notifica "invalid_shopee_creds".
 *  - Mercado Livre: afiliado DEVE ter melitat + sessionCookies. Sem um
 *    dos dois, bloqueia a oferta (Link Builder rejeita /social/, matt_word
 *    em cima de outro afiliado gera comissão errada).
 *  - Amazon: afiliado com trackingIds → usa. Senão, fallback global.
 *
 * Cache hit (Redis) retorna imediatamente sem re-converter.
 */
import {
  convertShopeeUrlWithCredentials,
  convertAmazonUrlWithAffiliate,
  generateShortAffiliateLink,
} from '@omestre/converters';
import { detectMarketplace, makeLogger } from '@omestre/shared';
import { processFailure } from '@omestre/worker-common';
import {
  UserCredentialsRepository,
  MlAffiliateRepository,
  AmazonAffiliateRepository,
} from '@omestre/db';
import { resolveRedirectUrl } from './resolve-redirect.ts';
import { resolveMeliRedirect, isMeliProductUrl } from './resolve-redirect.ts';
import { getCachedConversion } from './conversion-cache.ts';

const log = makeLogger('ingestor');

/**
 * Converte uma URL de oferta em link de afiliado, considerando o afiliado
 * (resolvido via instanceName) e fazendo cache local por 1h.
 *
 * Retorna { convertedUrl, marketplace, success } — convertedUrl pode ser
 * null mesmo com success=true (cache hit de conversão falhada anteriormente).
 */
export async function convertOfferUrl(
  originalUrl: string,
  affiliateId: number,
  instanceName: string,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
  error?: string;
}> {
  const marketplace = detectMarketplace(originalUrl);
  if (marketplace === 'unknown') {
    return { convertedUrl: null, marketplace, success: false };
  }

  let resolvedUrl = await resolveRedirectUrl(originalUrl);
  let effectiveMarketplace = marketplace;
  if (resolvedUrl !== originalUrl) {
    log('info', 'URL de redirector resolvida', {
      original: originalUrl,
      resolved: resolvedUrl,
      marketplace,
    });
    const resolvedMp = detectMarketplace(resolvedUrl);
    if (resolvedMp !== 'unknown') {
      effectiveMarketplace = resolvedMp;
    }
  }

  const cached = await getCachedConversion(resolvedUrl);
  if (cached) {
    log('info', 'Cache hit — URL já convertida recentemente', {
      url: resolvedUrl,
      marketplace: cached.marketplace,
      cachedAt: cached.timestamp,
    });
    return {
      convertedUrl: cached.convertedUrl,
      marketplace: cached.marketplace,
      success: cached.convertedUrl !== null,
    };
  }

  try {
    const userIdMatch = instanceName.match(/^user-(\d+)$/);
    if (!userIdMatch) {
      const { convertUrl } = await import('@omestre/converters');
      const result = await convertUrl(resolvedUrl);
      return {
        convertedUrl: result.affiliateUrl,
        marketplace: effectiveMarketplace,
        success: result.success,
        error: result.error,
      };
    }

    const userId = parseInt(userIdMatch[1]!, 10);

    if (effectiveMarketplace === 'shopee') {
      return await convertShopeeForAffiliate(resolvedUrl, userId);
    }
    if (effectiveMarketplace === 'mercadolivre') {
      return await convertMlForAffiliate(resolvedUrl, userId);
    }
    if (effectiveMarketplace === 'amazon') {
      return await convertAmazonForAffiliate(resolvedUrl, userId);
    }

    // Marketplaces conhecidos mas sem integração implementada
    // Exibe mensagem amigável e aparece nos logs de espelhamento como 'blocked'
    const unsupportedMarketplaces: Record<string, string> = {
      magalu: 'Magalu (Magazine Luiza)',
    };
    const unsupportedName = unsupportedMarketplaces[effectiveMarketplace];
    if (unsupportedName) {
      log('warn', 'Marketplace ainda não integrado — oferta bloqueada', {
        marketplace: effectiveMarketplace,
        url: resolvedUrl,
        userId,
      });
      return {
        convertedUrl: null,
        marketplace: effectiveMarketplace,
        success: false,
        error: `Marketplace ainda não liberado: ${unsupportedName}`,
      };
    }

    const { convertUrl } = await import('@omestre/converters');
    const result = await convertUrl(resolvedUrl);
    return {
      convertedUrl: result.affiliateUrl,
      marketplace: effectiveMarketplace,
      success: result.success,
      error: result.error,
    };
  } catch (err) {
    log('warn', 'Falha ao converter URL', {
      url: resolvedUrl,
      marketplace: effectiveMarketplace,
      affiliateId,
      error: String(err),
    });
    return {
      convertedUrl: null,
      marketplace: effectiveMarketplace,
      success: false,
      error: String(err),
    };
  }
}

/**
 * Conversão Shopee — usa credenciais do UserCredentialsRepository.
 * Fallback global via .env se afiliado não tem credenciais.
 */
async function convertShopeeForAffiliate(
  url: string,
  userId: number,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
  error?: string;
}> {
  const credsRepo = new UserCredentialsRepository();
  const creds = await credsRepo.findByUserId(userId);

  if (creds?.shopeeAppId && creds?.shopeeAppSecret) {
    const result = await convertShopeeUrlWithCredentials(url, {
      appId: creds.shopeeAppId,
      secret: creds.shopeeAppSecret,
    });
    return {
      convertedUrl: result.affiliateUrl,
      marketplace: 'shopee',
      success: result.success,
      error: result.error,
    };
  }

  log('info', 'Sem credenciais Shopee específicas — usando fallback global', { userId });
  const instanceName = `user-${userId}`;
  processFailure(instanceName, 'invalid_shopee_creds', { marketplace: 'shopee' }).catch(() => {});

  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'shopee',
    success: result.success,
    error: result.error,
  };
}

/**
 * Resolve um link curto meli.la/XXX para a URL de produto real do ML.
 *
 * IMPORTANTE: muitos meli.la escondem PERFIS SOCIAIS ou LISTAS de outros
 * afiliados (ex: /social/om895584/lists) — esses NÃO são produtos elegíveis.
 * Porém /social/<id> (sem sub-path) É uma página de produto (social commerce).
 * Use `resolveMeliRedirect` (em ./resolve-redirect.ts) que já trata isso:
 * segue o redirect, faz strip de params de tracking (matt_word/matt_tool/ref)
 * e retorna isProduct.
 */
async function convertMlForAffiliate(
  url: string,
  userId: number,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
  error?: string;
}> {
  const mlRepo = new MlAffiliateRepository();
  const mlAffiliate = await mlRepo.findByPlatformUserId(userId);

  if (mlAffiliate?.melitat) {
    // Resolve meli.la ANTES de tudo — o Link Builder só aceita URL real de
    // produto. meli.la/XXX é o próprio link curto de afiliado do ML, então
    // o redirect tipicamente leva para /social/<outro-afiliado>/lists — não
    // para um produto único. Mesmo assim tentamos o createLink porque
    // existem casos onde o redirect leva para uma página de produto real.
    //
    // `resolveMeliRedirect` já:
    //  - segue o redirect
    //  - strip de params de tracking do afiliado original (matt_word/matt_tool/ref)
    //  - detecta se URL final é /p/MLB<id> (produto) ou /social/... (perfil/lista)
    const resolved = await resolveMeliRedirect(url);
    const isProductFromRedirect = /meli\.la/i.test(url);
    const isProduct = isProductFromRedirect ? resolved.isProduct : isMeliProductUrl(resolved.url);
    const targetUrl = resolved.url;

    // Bloqueia oferta se a URL (meli.la OU direta ML) não leva a uma página
    // de PRODUTO. Perfis sociais, listas, cupons, etc. não são elegíveis e o
    // Link Builder rejeitaria (erro 111). Logamos o motivo para debug futuro.
    if (!isProduct) {
      log('info', 'meli.la não leva a produto — bloqueando oferta', {
        userId,
        originalUrl: url,
        resolvedUrl: targetUrl,
        reason: resolved.reason ?? 'not_product_url',
        droppedParams: resolved.droppedParams ?? [],
      });
      return {
        convertedUrl: null,
        marketplace: 'mercadolivre',
        success: false,
        error: `meli.la não redireciona para produto: ${resolved.reason ?? 'not_product_url'}`,
      };
    }

    // Log info quando houve strip de params de tracking (indicador de que
    // estava vindo com tracking do afiliado original)
    if (resolved.droppedParams && resolved.droppedParams.length > 0) {
      log('info', 'meli.la: removidos params de tracking de outro afiliado', {
        userId,
        originalUrl: url,
        canonicalUrl: targetUrl,
        droppedParams: resolved.droppedParams,
      });
    }

    // Sem cookies OU cookies expirados (HTTP 40*) — não tenta fallback de
    // URL params: anexar matt_word em cima de uma URL /social/<outro> deixa
    // dois matt_word conflitantes (o do link original ganha, comissão vai
    // para o afiliado errado). Bloqueia a oferta e notifica.
    if (!mlAffiliate.sessionCookies) {
      log('info', 'Afiliado ML sem cookies de sessão — bloqueando oferta', {
        userId,
        url: targetUrl,
      });
      return {
        convertedUrl: null,
        marketplace: 'mercadolivre',
        success: false,
        error: 'Sem cookies de sessão ML para usar o Link Builder',
      };
    }

    const shortResult = await generateShortAffiliateLink(
      targetUrl,
      mlAffiliate.melitat,
      mlAffiliate.sessionCookies,
    );

    if (shortResult.success && shortResult.shortUrl) {
      return {
        convertedUrl: shortResult.shortUrl,
        marketplace: 'mercadolivre',
        success: true,
      };
    }

    // Link builder falhou — classifica o motivo.
    const errorMsg = shortResult.error ?? 'erro desconhecido';
    const isCookieError =
      errorMsg.includes('HTTP 40') ||
      errorMsg.includes('Cookies podem estar expirados') ||
      errorMsg.toLowerCase().includes('unauthorized');

    if (isCookieError) {
      const instanceName = `user-${userId}`;
      processFailure(instanceName, 'cookie_expired', { marketplace: 'mercadolivre' }).catch(
        () => {},
      );
    } else {
      log('info', 'Link builder ML rejeitou a oferta — bloqueando', {
        userId,
        url: targetUrl,
        error: errorMsg,
      });
    }

    // Em QUALQUER falha do Link Builder, bloqueia a oferta para este
    // targetGroup. Sem fallback de URL params — gera comissão para o
    // afiliado errado e polui o espelho com links não-confiáveis.
    return {
      convertedUrl: null,
      marketplace: 'mercadolivre',
      success: false,
      error: errorMsg,
    };
  }

  log('info', 'Afiliado ML sem tag (melitat) — bloqueando oferta', { userId });
  const instanceName = `user-${userId}`;
  processFailure(instanceName, 'ml_account_not_linked', { marketplace: 'mercadolivre' }).catch(
    () => {},
  );

  return {
    convertedUrl: null,
    marketplace: 'mercadolivre',
    success: false,
    error: 'Afiliado ML sem tag (melitat) configurada. Reimporte os cookies pela extensão Chrome.',
  };
}

/**
 * Conversão Amazon — usa trackingIds do AmazonAffiliateRepository.
 * Fallback global via .env se afiliado não tem tracking IDs.
 */
async function convertAmazonForAffiliate(
  url: string,
  userId: number,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
  error?: string;
}> {
  const amazonRepo = new AmazonAffiliateRepository();
  const amazonAffiliate = await amazonRepo.findByUserId(userId);

  if (amazonAffiliate && (amazonAffiliate.trackingIds ?? []).length > 0) {
    const result = await convertAmazonUrlWithAffiliate(url, amazonAffiliate.trackingIds ?? []);
    return {
      convertedUrl: result.affiliateUrl,
      marketplace: 'amazon',
      success: result.success,
      error: result.error,
    };
  }

  log('info', 'Afiliado Amazon sem tracking IDs — usando fallback global', { userId });
  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'amazon',
    success: result.success,
    error: result.error,
  };
}
