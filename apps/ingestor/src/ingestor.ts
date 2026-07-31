/**
 * Ingestor — Pipeline de processamento de mensagens cruas.
 *
 * Fluxo:
 *   0. Sanitização: remove links não-oferta (t.me/*) do texto
 *   1. Extrai URLs de marketplace do texto sanitizado (url-extraction.ts)
 *   2. Resolve TODOS os links (multi-link) e classifica
 *   3. Seleciona a URL de produto (bloqueia se 0 ou ≥2)
 *   4. Reconstrói o texto com URLs resolvidas
 *   5. Blacklist + Whitelist global (terms-lists.ts)
 *   6. Busca configs do sourceGroup (source-group-cache.ts)
 *   7. Fan-out por afiliado (paralelo):
 *      a. Converte link com credenciais do afiliado (link-converters.ts)
 *      b. Verifica link (safety check) (link-verifier.ts)
 *      c. Monta template (template-builder.ts)
 *      d. Publica SendEvent na Queue B
 *   8. Fetch product image (opcional, fallback texto)
 *   9. Publica na Queue B
 *  10. ACK na Queue A
 *
 * Módulos auxiliares (cada um com responsabilidade única):
 *   - url-extraction.ts:    classifyLinkKind, extractAllMarketplaceLinks,
 *                           extractMarketplaceUrl, sanitizeNonOfferLinks
 *   - terms-lists.ts:       loadBlacklist, loadWhitelist (cache em globalThis)
 *   - dedup.ts:             isDuplicate (24h via reflected_offers)
 *   - source-group-cache.ts: getSourceGroupConfigs (1:N Redis)
 *   - link-converters.ts:   convertOfferUrl + sub-converters por marketplace
 *   - link-verifier.ts:     verifyAffiliateLink (safety check)
 *   - template-builder.ts:  buildTemplateMessage
 *   - offer-logger.ts:      logReflectedOffer (INSERT em reflected_offers)
 *   - metrics.ts:           steps (StepTrackers) + initMetrics()
 *   - redis.ts:             getRedis() lazy singleton
 */

import { randomUUID } from 'node:crypto';
import type { RawMessageEvent, SendEvent, TemplateContext } from '@omestre/shared';
import {
  detectMarketplace,
  MIRROR_SEND_STREAM,
  MIRROR_SEND_DEDUP_PREFIX,
  MIRROR_SEND_DEDUP_TTL,
  makeLogger,
} from '@omestre/shared';
import {
  classifyConversionError,
  measureStep,
  measureStepSync,
  processFailure,
  incrementCounter,
} from '@omestre/worker-common';
import { MlAffiliateRepository } from '@omestre/db';
import { resolveRedirectUrl, isMeliProductUrl } from './resolve-redirect.ts';
import {
  classifyResolvedProductUrl,
  reconstructText,
  buildTemplateContext,
  buildSendEvent,
  resolveSendDedupKey,
  parseAffiliateUserId,
  isSocialCommerceUrl,
} from './ingestor-pure.ts';
import { fetchProductImage } from './product-image.ts';
import { getRedis } from './redis.ts';
import { steps } from './metrics.ts';
import { logReflectedOffer } from './offer-logger.ts';
import { resolveCatalogTarget } from '@omestre/shared';
import { publishCatalogJob } from '@omestre/worker-common';

// Re-exporta funções puras de url-extraction.ts para compatibilidade
// com testes existentes e callers externos.
export {
  classifyLinkKind,
  extractAllMarketplaceLinks,
  extractMarketplaceUrl,
  sanitizeNonOfferLinks,
} from './url-extraction.ts';
export type { LinkKind, ExtractedLink } from './url-extraction.ts';

import { sanitizeNonOfferLinks, extractAllMarketplaceLinks } from './url-extraction.ts';
import { loadBlacklist, loadWhitelist, matchAnyTerm } from './terms-lists.ts';
import { getSourceGroupConfigs } from './source-group-cache.ts';
import { convertOfferUrl } from './link-converters.ts';
import { setCachedConversion } from './conversion-cache.ts';
import { verifyAffiliateLink } from './link-verifier.ts';
import { buildTemplateMessage } from './template-builder.ts';

const log = makeLogger('ingestor');

/**
 * Processa uma mensagem crua da Queue A.
 * Retorna true se deve dar ACK (processada), false se deve retentar.
 */
export async function processRawMessage(event: RawMessageEvent): Promise<boolean> {
  const { messageId, instanceName, sourceGroupJid, sourceGroupName, text } = event;
  const totalStart = performance.now();

  log('info', 'Processando mensagem crua', {
    messageId,
    instanceName,
    sourceGroupJid,
    sourceGroupName: sourceGroupName || '(desconhecido)',
    textLength: text.length,
  });

  incrementCounter('pipeline_messages_received_total');

  // ── 0. Sanitização: remove links que não são da oferta ──
  // Links de Telegram (t.me/*) são divulgação do bot original, não fazem
  // parte da oferta. Removidos ANTES da extração para não poluir o pipeline.
  const sanitizedText = sanitizeNonOfferLinks(text);

  // ── 1. Extrai URLs de marketplace ──
  // Mensagens podem trazer MAIS DE UM link (ex.: produto + cupom + campanha).
  // Regra: se houver ≥2 links de PRODUTO, bloqueia (nunca deveria ter 2
  // produtos na mesma oferta). Links informativos (campanha, cupom) são
  // resolvidos e mantidos no texto, mas NÃO vão para o Link Builder.
  const extractedLinks = measureStepSync(steps.extract, () =>
    extractAllMarketplaceLinks(sanitizedText),
  );
  if (extractedLinks.length === 0) {
    log('info', 'Mensagem sem URL de marketplace — ignorada', { messageId });
    incrementCounter('pipeline_messages_blocked_total', { reason: 'no_url' });
    return true;
  }

  const productLinks = extractedLinks.filter((l) => l.kind === 'product');

  if (productLinks.length >= 2) {
    log('info', 'Múltiplos links de produto na mesma mensagem — bloqueada', {
      messageId,
      productCount: productLinks.length,
      productUrls: productLinks.map((l) => l.url),
    });
    incrementCounter('pipeline_messages_blocked_total', { reason: 'multiple_product_links' });
    return true;
  }

  // ── 2. Resolução multi-link ──
  // Resolve TODOS os links extraídos (não só o selecionado) para:
  //   a) Descobrir se shortlinks (meli.la, s.shopee.com.br, /sec/) levam a
  //      produto real ou página informativa
  //   b) Reconstruir o texto com URLs resolvidas (mais limpas e informativas)
  //
  // Cada link resolvido recebe uma classificação:
  //   - 'product':     URL final é página de produto → vai pro Link Builder
  //   - 'informative': URL final é campanha/listagem → mantida no texto, não convertida
  //   - 'discard':     não resolveu ou não é marketplace → removida do texto
  interface ResolvedLink {
    originalUrl: string;
    resolvedUrl: string;
    role: 'product' | 'informative' | 'discard';
    marketplace: string;
  }

  const resolvedLinks: ResolvedLink[] = [];

  for (const link of extractedLinks) {
    const resolved = await resolveRedirectUrl(link.url);
    const resolvedMarketplace = detectMarketplace(resolved);

    if (resolvedMarketplace === 'unknown') {
      resolvedLinks.push({
        originalUrl: link.url,
        resolvedUrl: resolved,
        role: 'discard',
        marketplace: 'unknown',
      });
      continue;
    }

    // Classifica o destino resolvido (lógica pura em ingestor-pure.ts)
    const isProduct = classifyResolvedProductUrl(resolved, resolvedMarketplace);

    resolvedLinks.push({
      originalUrl: link.url,
      resolvedUrl: resolved,
      role: isProduct ? 'product' : 'informative',
      marketplace: resolvedMarketplace,
    });
  }

  // ── 3. Seleção da URL de produto ──
  const productResolved = resolvedLinks.filter((l) => l.role === 'product');
  const informativeResolved = resolvedLinks.filter((l) => l.role === 'informative');

  if (productResolved.length === 0) {
    // Nenhum link resolveu para produto — verifica se há links informativos
    // (ex.: só campanha/cupom). Se sim, loga e descarta (não é oferta de produto).
    if (informativeResolved.length > 0) {
      log('info', 'Mensagem só contém links informativos (campanha/cupom) — ignorada', {
        messageId,
        informativeUrls: informativeResolved.map((l) => l.resolvedUrl),
      });
      incrementCounter('pipeline_messages_blocked_total', { reason: 'informative_only' });
    } else {
      log('info', 'Mensagem sem links de produto após resolução — ignorada', {
        messageId,
        links: extractedLinks.map((l) => l.url),
      });
      incrementCounter('pipeline_messages_blocked_total', { reason: 'no_product_after_resolve' });
    }
    return true;
  }

  if (productResolved.length >= 2) {
    log('info', 'Múltiplos links de produto após resolução — bloqueada', {
      messageId,
      productUrls: productResolved.map((l) => l.resolvedUrl),
    });
    incrementCounter('pipeline_messages_blocked_total', { reason: 'multiple_product_links' });
    return true;
  }

  const selectedProduct = productResolved[0]!;
  const originalUrl = selectedProduct.originalUrl;
  let resolvedUrl = selectedProduct.resolvedUrl;
  const marketplace = selectedProduct.marketplace;
  let socialImageUrl: string | null = null;

  // ── 3.5. Resolução de /social/<id> → produto real ──
  // Páginas /social/<id> do ML são social commerce: o Link Builder rejeita
  // essas URLs (erro 111). Precisamos extrair a URL real do produto (/p/MLB<id>)
  // navegando na página e clicando em "Ir para o Produto".
  if (marketplace === 'mercadolivre' && isSocialCommerceUrl(resolvedUrl)) {
    const { resolveSocialProductUrl } = await import('./resolve-social-product.ts');
    const socialResolution = await resolveSocialProductUrl(resolvedUrl);
    if (socialResolution) {
      log('info', '/social/ resolvido para produto real', {
        messageId,
        socialUrl: resolvedUrl,
        productUrl: socialResolution.productUrl,
        imageUrl: socialResolution.imageUrl,
      });
      resolvedUrl = socialResolution.productUrl;
      socialImageUrl = socialResolution.imageUrl;
    } else {
      log(
        'warn',
        '/social/ não pôde ser resolvido para produto — tentando Link Builder mesmo assim',
        {
          messageId,
          socialUrl: resolvedUrl,
        },
      );
    }
  }

  // ── 3.6. Identidade de catálogo (parse, sem rede) ──
  // Resolve `marketplace:itemId` da URL resolvida. É a chave de correlação
  // da oferta espelhada ↔ catálogo (Queue C): preenchida no SendEvent
  // (productKey) e publicada via CatalogJob no passo 10.5.
  const catalogTarget = resolveCatalogTarget(marketplace, resolvedUrl);

  // ── 4. Reconstrução do texto (lógica pura em ingestor-pure.ts) ──
  // 'product' não é substituído aqui — será substituído pela URL convertida
  // no template (buildTemplateMessage faz text.replace(originalUrl, convertedUrl))
  const processedText = reconstructText(sanitizedText, resolvedLinks);

  log('info', 'URL de marketplace detectada e resolvida', {
    messageId,
    originalUrl,
    resolvedUrl,
    marketplace,
    totalLinks: extractedLinks.length,
    productCount: productResolved.length,
    informativeCount: informativeResolved.length,
    discardedCount: resolvedLinks.filter((l) => l.role === 'discard').length,
  });

  // ── 5. Blacklist ──
  const blacklistTerms = await measureStep(steps.blacklist, async () => loadBlacklist());
  if (blacklistTerms.length > 0) {
    const match = matchAnyTerm(sanitizedText, blacklistTerms);
    if (match.matched) {
      log('info', 'Mensagem filtrada pela blacklist', { messageId, term: match.term });
      incrementCounter('pipeline_messages_blocked_total', { reason: 'global_blacklist' });
      return true;
    }
  }

  // ── 6. Whitelist ──
  const whitelistTerms = await measureStep(steps.whitelist, async () => loadWhitelist());
  if (whitelistTerms.length > 0) {
    const hasMatch = matchAnyTerm(sanitizedText, whitelistTerms).matched;
    if (!hasMatch) {
      log('info', 'Mensagem filtrada pela whitelist', { messageId });
      incrementCounter('pipeline_messages_blocked_total', { reason: 'global_whitelist' });
      return true;
    }
  }

  // ── 7. Source Group Configs ──
  const sourceConfigs = await getSourceGroupConfigs(sourceGroupJid);
  if (sourceConfigs.length === 0) {
    log('info', 'Nenhum afiliado configurado para este sourceGroup', { sourceGroupJid });
    return true;
  }

  // ── 8. Fan-out: para cada afiliado (valida credenciais + converte) ──
  // A busca de imagem vem DEPOIS do fan-out: só faz sentido gastar o
  // recurso de rede (fetch no marketplace) se ao menos um afiliado tiver
  // credenciais válidas e gerar um SendEvent. Isso evita buscar imagem
  // atoa quando nenhum afiliado consegue converter a oferta.
  const r = getRedis();
  if (!r) {
    log('error', 'Redis indisponível — não é possível publicar na Queue B');
    return false;
  }

  const sendEvents: SendEvent[] = [];

  await measureStep(steps.fanOut, async () => {
    const results = await Promise.allSettled(
      sourceConfigs.map(async (config) => {
        // Send-dedup: já publicamos para este mirror+messageId?
        const sendDedupKey = resolveSendDedupKey(config.mirrorId, messageId);
        const alreadySent = await r.get(sendDedupKey);
        if (alreadySent) {
          log('info', 'SendEvent já publicado — pulando (crash recovery)', {
            mirrorId: config.mirrorId,
            messageId,
          });
          return null;
        }

        // Converte link com credenciais do afiliado
        const conversion = await convertOfferUrl(
          resolvedUrl,
          config.affiliateId,
          config.instanceName,
        );
        if (!conversion.success) {
          incrementCounter('pipeline_messages_blocked_total', { reason: 'conversion_failed' });

          let failureReason: string | undefined;

          if (conversion.error) {
            const failureType = classifyConversionError(conversion.marketplace, conversion.error);
            if (failureType) {
              processFailure(config.instanceName, failureType, {
                marketplace: conversion.marketplace,
              }).catch(() => {});
              failureReason = failureType;
            } else {
              failureReason = conversion.error;
            }
          }

          // Registra nos logs de espelhamento (reflected_offers) para que o
          // usuário veja que a oferta foi capturada mas bloqueada por config.
          logReflectedOffer({
            affiliateId: config.affiliateId,
            sourceGroupJid,
            targetGroupJid: config.targetGroupJid,
            originalLink: resolvedUrl,
            convertedLink: null,
            marketplace: conversion.marketplace,
            messagePreview: conversion.error ?? 'Erro de conversão',
            status: 'blocked',
            failureReason: failureReason ?? 'conversion_failed',
          }).catch(() => {});

          return null;
        }

        // Verifica safety
        const linkCheck = await verifyAffiliateLink(
          conversion.convertedUrl,
          config.affiliateId,
          conversion.marketplace,
        );
        if (!linkCheck.valid) {
          incrementCounter('pipeline_messages_blocked_total', {
            reason: 'affiliate_link_mismatch',
          });
          return null;
        }

        // Cache a conversão bem-sucedida
        await setCachedConversion(resolvedUrl, {
          convertedUrl: conversion.convertedUrl,
          marketplace: conversion.marketplace,
          timestamp: new Date().toISOString(),
        });

        // Monta template — usa processedText (texto sanitizado + URLs resolvidas)
        const ctx = buildTemplateContext({
          processedText,
          originalUrl,
          convertedUrl: conversion.convertedUrl!,
          marketplace: conversion.marketplace,
          sourceGroupName,
          targetGroupName: config.targetGroupName,
          timestamp: new Date(),
        });
        const templateText = buildTemplateMessage(ctx, config.messageTemplate);

        const sendEvent = buildSendEvent({
          id: randomUUID(),
          sourceMessageId: messageId,
          sourceGroupJid,
          mirrorId: config.mirrorId,
          text: templateText,
          marketplace: conversion.marketplace,
          originalUrl,
          convertedUrl: conversion.convertedUrl!,
          productKey: catalogTarget?.productKey,
        });

        return sendEvent;
      }),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        sendEvents.push(result.value);
      }
    }
  });

  incrementCounter('pipeline_affiliates_per_message', { count: String(sourceConfigs.length) });

  // ── 9. Fetch product image (só se houver SendEvent válido) ──
  // A imagem é OPCIONAL com fallback: se não for encontrada (ex.: Shopee
  // bloqueando extração server-side, ou Amazon bloqueando bots), a oferta
  // ainda é enviada como TEXTO (sendText) em vez de ser bloqueada — evitando
  // regredir o comportamento do v1 (que enviava sem imagem). O Dispatcher
  // já trata imageUrl vazio como envio de texto.
  // Busca-se UMA vez por mensagem (a oferta é a mesma para todos os
  // afiliados do sourceGroup) e só após confirmar que ao menos um afiliado
  // gerou um SendEvent válido — evitando desperdício de rede.
  let imageUrl = '';
  if (sendEvents.length > 0) {
    let sessionCookies: string | null = null;
    if (marketplace === 'mercadolivre' && !socialImageUrl) {
      const firstMlConfig = sourceConfigs.find((config) =>
        sendEvents.some((event) => event.mirrorId === config.mirrorId),
      );
      if (firstMlConfig) {
        const userId = parseAffiliateUserId(firstMlConfig.instanceName);
        if (userId != null) {
          const mlRepo = new MlAffiliateRepository();
          const mlAffiliate = await mlRepo.findByPlatformUserId(userId);
          sessionCookies = mlAffiliate?.sessionCookies ?? null;
        }
      }
    }

    imageUrl =
      (await measureStep(steps.imageFetch, () =>
        fetchProductImage(marketplace, resolvedUrl, {
          preferredImageUrl: socialImageUrl,
          sessionCookies,
        }),
      )) || '';
  }
  if (imageUrl) {
    incrementCounter('pipeline_image_fetch_total', { marketplace, result: 'found' });
  } else {
    log('info', 'Imagem de produto não encontrada — enviando como texto (fallback)', {
      messageId,
      marketplace,
      resolvedUrl,
    });
    incrementCounter('pipeline_image_fetch_total', { marketplace, result: 'not_found' });
    incrementCounter('pipeline_image_missing_fallback_total', { marketplace });
  }

  // Aplica a imagem (ou string vazia) em todos os SendEvents gerados
  for (const evt of sendEvents) {
    evt.imageUrl = imageUrl;
  }

  // ── 10. Publica na Queue B ──
  if (sendEvents.length > 0) {
    const pipeline = r.pipeline();
    for (const evt of sendEvents) {
      pipeline.xadd(MIRROR_SEND_STREAM, '*', 'payload', JSON.stringify(evt));
      // Marca send-dedup
      const sendDedupKey = resolveSendDedupKey(evt.mirrorId, messageId);
      pipeline.setex(sendDedupKey, MIRROR_SEND_DEDUP_TTL, '1');
    }
    await pipeline.exec();

    incrementCounter('pipeline_send_events_published_total', { count: String(sendEvents.length) });

    log('info', 'SendEvents publicados na Queue B', {
      messageId,
      count: sendEvents.length,
      mirrorIds: sendEvents.map((e) => e.mirrorId),
    });
  }

  // ── 10.5. Publica CatalogJob na Queue C (fire-and-forget) ──
  // O Ingestor SÓ PUBLICA a identidade do produto (XADD O(1)); quem grava
  // o catálogo é o CatalogWorker. Falha na publicação NUNCA quebra o
  // espelhamento — try/catch isolado que apenas loga warn.
  if (sendEvents.length > 0) {
    const firstConfig = sourceConfigs.find((config) =>
      sendEvents.some((event) => event.mirrorId === config.mirrorId),
    );
    const userId = firstConfig ? parseAffiliateUserId(firstConfig.instanceName) : null;
    try {
      void publishCatalogJob(
        {
          marketplace,
          resolvedUrl,
          sourceGroupJid,
          messageId,
          userId,
        },
        r,
      ).catch((err: unknown) => {
        log('warn', 'Falha ao publicar CatalogJob na Queue C', {
          messageId,
          error: String(err),
        });
      });
    } catch (err) {
      log('warn', 'Falha ao publicar CatalogJob na Queue C', {
        messageId,
        error: String(err),
      });
    }
  }

  // ── 11. ACK na Queue A ──
  const totalDuration = performance.now() - totalStart;
  steps.total.observe(totalDuration);

  log(
    sendEvents.length === 0 && sourceConfigs.length > 0 ? 'warn' : 'info',
    sendEvents.length === 0 && sourceConfigs.length > 0
      ? 'Mensagem processada sem SendEvents — todos os afiliados falharam na conversão'
      : 'Mensagem processada com sucesso',
    {
      messageId,
      durationMs: Math.round(totalDuration),
      sendEventsCount: sendEvents.length,
      affiliatesCount: sourceConfigs.length,
    },
  );

  return true;
}

// Re-export initMetrics de metrics.ts para compatibilidade com index.ts
export { initMetrics } from './metrics.ts';
