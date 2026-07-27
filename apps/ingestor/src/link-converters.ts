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
 *
 * Toda a lógica PURA de decisão/classificação/construção vive em
 * `link-converters-pure.ts` (100% coberta por link-converters-pure.test.ts).
 * Este módulo é a camada fina de I/O que resolve dados e delega.
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
import type { ConversionResult } from './link-converters-pure.ts';
import {
  extractUserIdFromInstanceName,
  buildInstanceName,
  resolveEffectiveMarketplace,
  classifyUnsupportedMarketplace,
  buildUnsupportedMarketplaceError,
  toConversionResult,
  buildCachedConversionResult,
  buildBlockedResult,
  decideMeliProductStatus,
  buildMeliNotProductError,
  classifyMlShortLinkResult,
  hasShopeeCredentials,
  hasAmazonTrackingIds,
  ML_NO_COOKIES_ERROR,
  ML_NO_TAG_ERROR,
} from './link-converters-pure.ts';

// Re-export das puras para compatibilidade com consumidores/testes antigos.
export {
  extractUserIdFromInstanceName,
  resolveEffectiveMarketplace,
  classifyUnsupportedMarketplace,
} from './link-converters-pure.ts';

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
): Promise<ConversionResult> {
  const marketplace = detectMarketplace(originalUrl);
  if (marketplace === 'unknown') {
    return { convertedUrl: null, marketplace, success: false };
  }

  let resolvedUrl = await resolveRedirectUrl(originalUrl);
  let effectiveMarketplace = resolveEffectiveMarketplace(marketplace, originalUrl, resolvedUrl);
  if (resolvedUrl !== originalUrl) {
    log('info', 'URL de redirector resolvida', {
      original: originalUrl,
      resolved: resolvedUrl,
      marketplace,
    });
  }

  const cached = await getCachedConversion(resolvedUrl);
  if (cached) {
    log('info', 'Cache hit — URL já convertida recentemente', {
      url: resolvedUrl,
      marketplace: cached.marketplace,
      cachedAt: cached.timestamp,
    });
    return buildCachedConversionResult(cached);
  }

  try {
    const userId = extractUserIdFromInstanceName(instanceName);
    if (userId === null) {
      const { convertUrl } = await import('@omestre/converters');
      const result = await convertUrl(resolvedUrl);
      return toConversionResult(effectiveMarketplace, result);
    }

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
    const unsupportedName = classifyUnsupportedMarketplace(effectiveMarketplace);
    if (unsupportedName) {
      log('warn', 'Marketplace ainda não integrado — oferta bloqueada', {
        marketplace: effectiveMarketplace,
        url: resolvedUrl,
        userId,
      });
      return buildBlockedResult(
        effectiveMarketplace,
        buildUnsupportedMarketplaceError(unsupportedName),
      );
    }

    const { convertUrl } = await import('@omestre/converters');
    const result = await convertUrl(resolvedUrl);
    return toConversionResult(effectiveMarketplace, result);
  } catch (err) {
    log('warn', 'Falha ao converter URL', {
      url: resolvedUrl,
      marketplace: effectiveMarketplace,
      affiliateId,
      error: String(err),
    });
    return buildBlockedResult(effectiveMarketplace, String(err));
  }
}

/**
 * Conversão Shopee — usa credenciais do UserCredentialsRepository.
 * Fallback global via .env se afiliado não tem credenciais.
 */
async function convertShopeeForAffiliate(url: string, userId: number): Promise<ConversionResult> {
  const credsRepo = new UserCredentialsRepository();
  const creds = await credsRepo.findByUserId(userId);

  if (hasShopeeCredentials(creds)) {
    const result = await convertShopeeUrlWithCredentials(url, {
      appId: creds!.shopeeAppId!,
      secret: creds!.shopeeAppSecret!,
    });
    return toConversionResult('shopee', result);
  }

  log('info', 'Sem credenciais Shopee específicas — usando fallback global', { userId });
  processFailure(buildInstanceName(userId), 'invalid_shopee_creds', {
    marketplace: 'shopee',
  }).catch(() => {});

  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return toConversionResult('shopee', result);
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
async function convertMlForAffiliate(url: string, userId: number): Promise<ConversionResult> {
  const mlRepo = new MlAffiliateRepository();
  const mlAffiliate = await mlRepo.findByPlatformUserId(userId);

  if (mlAffiliate?.melitat) {
    // Resolve meli.la ANTES de tudo — o Link Builder só aceita URL real de
    // produto. `resolveMeliRedirect` já segue o redirect, faz strip de params
    // de tracking do afiliado original e detecta se a URL final é produto.
    const resolved = await resolveMeliRedirect(url);
    const isProduct = decideMeliProductStatus(
      url,
      resolved.isProduct,
      isMeliProductUrl(resolved.url),
    );
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
      return buildBlockedResult('mercadolivre', buildMeliNotProductError(resolved.reason));
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
      return buildBlockedResult('mercadolivre', ML_NO_COOKIES_ERROR);
    }

    const shortResult = await generateShortAffiliateLink(
      targetUrl,
      mlAffiliate.melitat,
      mlAffiliate.sessionCookies,
    );

    const outcome = classifyMlShortLinkResult(shortResult);

    if (outcome.kind === 'success') {
      return {
        convertedUrl: outcome.shortUrl,
        marketplace: 'mercadolivre',
        success: true,
      };
    }

    if (outcome.kind === 'cookie_error') {
      processFailure(buildInstanceName(userId), 'cookie_expired', {
        marketplace: 'mercadolivre',
      }).catch(() => {});
    } else {
      log('info', 'Link builder ML rejeitou a oferta — bloqueando', {
        userId,
        url: targetUrl,
        error: outcome.errorMsg,
      });
    }

    // Em QUALQUER falha do Link Builder, bloqueia a oferta para este
    // targetGroup. Sem fallback de URL params — gera comissão para o
    // afiliado errado e polui o espelho com links não-confiáveis.
    return buildBlockedResult('mercadolivre', outcome.errorMsg);
  }

  log('info', 'Afiliado ML sem tag (melitat) — bloqueando oferta', { userId });
  processFailure(buildInstanceName(userId), 'ml_account_not_linked', {
    marketplace: 'mercadolivre',
  }).catch(() => {});

  return buildBlockedResult('mercadolivre', ML_NO_TAG_ERROR);
}

/**
 * Conversão Amazon — usa trackingIds do AmazonAffiliateRepository.
 * Fallback global via .env se afiliado não tem tracking IDs.
 */
async function convertAmazonForAffiliate(url: string, userId: number): Promise<ConversionResult> {
  const amazonRepo = new AmazonAffiliateRepository();
  const amazonAffiliate = await amazonRepo.findByUserId(userId);

  if (hasAmazonTrackingIds(amazonAffiliate)) {
    const result = await convertAmazonUrlWithAffiliate(url, amazonAffiliate!.trackingIds ?? []);
    return toConversionResult('amazon', result);
  }

  log('info', 'Afiliado Amazon sem tracking IDs — usando fallback global', { userId });
  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return toConversionResult('amazon', result);
}
