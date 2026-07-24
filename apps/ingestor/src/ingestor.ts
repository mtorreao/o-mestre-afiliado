/**
 * Ingestor — Pipeline de processamento de mensagens cruas.
 *
 * Fluxo:
 *   1. Lê RawMessageEvent da Queue A (omestre:mirror:raw)
 *   2. Dedup (messageId + sourceGroupJid) — 5 min
 *   3. Extrai URL de marketplace
 *   4. Blacklist / Whitelist global
 *   5. Dedup 24h (URL original no banco)
 *   6. Resolve redirect (Promozone)
 *   7. Fetch product image (obrigatório)
 *   8. Busca afiliados do sourceGroup (cache 1:N)
 *   9. Para CADA afiliado (fan-out em paralelo):
 *      a. Converte link com credenciais do afiliado
 *      b. Verifica link (safety check)
 *      c. Monta template
 *      d. Publica SendEvent na Queue B
 *   10. ACK na Queue A
 */

import type { RawMessageEvent, SendEvent, SourceGroupConfig, TemplateContext } from '@omestre/shared';
import {
  detectMarketplace,
  resolvePlaceholders,
  processConditionalsHuman,
  buildEvalContext,
  MIRROR_SEND_STREAM,
  MIRROR_SEND_DEDUP_PREFIX,
  MIRROR_SEND_DEDUP_TTL,
  MIRROR_SOURCE_GROUP_CACHE_PREFIX,
} from '@omestre/shared';
import {
  convertShopeeUrlWithCredentials,
  generateViaUrlParams,
  generateShortAffiliateLink,
  convertAmazonUrlWithTrackingId,
} from '@omestre/converters';
import {
  getDb,
  affiliates,
  mirrors,
  reflectedOffers,
  UserCredentialsRepository,
  MlAffiliateRepository,
  MirrorRepository,
} from '@omestre/db';
import { eq, and, gte } from 'drizzle-orm';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'fs';
import { resolveRedirectUrl } from './resolve-redirect.ts';
import { getCachedConversion, setCachedConversion } from './conversion-cache.ts';
import { fetchProductImage } from './product-image.ts';
import {
  StepTracker,
  measureStep,
  measureStepSync,
  processFailure,
  classifyConversionError,
  pushToDLQ,
  createCounter,
  incrementCounter,
  observeHistogram,
  registerStepTrackers,
  setStatusMeta,
} from '@omestre/worker-common';

// ─── Config ──────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';

// ─── Step Trackers ───────────────────────────────────────────────────

const steps = {
  dedup: new StepTracker(),
  extract: new StepTracker(),
  blacklist: new StepTracker(),
  whitelist: new StepTracker(),
  imageFetch: new StepTracker(),
  resolveRedirect: new StepTracker(),
  fanOut: new StepTracker(),
  total: new StepTracker(),
};

// ─── Logging ─────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'ingestor',
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── Blacklist / Whitelist ───────────────────────────────────────────

interface TermsFile {
  terms: string[];
}

function loadTermsList(envPath: string, defaultPath: string, label: string): string[] {
  const cacheKey = `_cache_${label}` as keyof typeof globalThis;
  if ((globalThis as Record<string, unknown>)[cacheKey] !== undefined) {
    return (globalThis as Record<string, unknown>)[cacheKey] as string[];
  }

  const filePath = process.env[envPath] || defaultPath;
  try {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, 'utf-8');
      const config = JSON.parse(raw) as TermsFile;
      const terms = config.terms ?? [];
      (globalThis as Record<string, unknown>)[cacheKey] = terms;
      log('info', `${label} carregada: ${terms.length} termo(s) de ${filePath}`);
      return terms;
    }
    log('info', `Arquivo ${filePath} não encontrado, ${label.toLowerCase()} vazia`);
  } catch (err) {
    log('warn', `Erro ao carregar ${label.toLowerCase()}`, { path: filePath, error: String(err) });
  }

  (globalThis as Record<string, unknown>)[cacheKey] = [];
  return [];
}

function loadBlacklist(): string[] {
  return loadTermsList('BLACKLIST_PATH', '../../blacklist.json', 'Blacklist');
}

function loadWhitelist(): string[] {
  return loadTermsList('WHITELIST_PATH', '../../whitelist.json', 'Whitelist');
}

// ─── URL Extraction ──────────────────────────────────────────────────

function extractMarketplaceUrl(text: string): string | null {
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const urls = text.match(urlRegex);
  if (!urls) return null;

  const REDIRECTOR_DOMAINS = /go\.promozone\.ai/i;

  for (const url of urls) {
    if (REDIRECTOR_DOMAINS.test(url)) continue;
    const marketplace = detectMarketplace(url);
    if (marketplace !== 'unknown') return url;
  }

  for (const url of urls) {
    const marketplace = detectMarketplace(url);
    if (marketplace !== 'unknown') return url;
  }
  return null;
}

// ─── Dedup 24h (DB) ──────────────────────────────────────────────────

async function isDuplicate(
  affiliateId: number,
  originalUrl: string,
  dedupHours: number = 24,
): Promise<boolean> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - dedupHours * 60 * 60 * 1000);

    const existing = await db
      .select({ id: reflectedOffers.id })
      .from(reflectedOffers)
      .where(
        and(
          eq(reflectedOffers.affiliateId, affiliateId),
          eq(reflectedOffers.originalLink, originalUrl),
          gte(reflectedOffers.reflectedAt, cutoff),
        ),
      )
      .limit(1);

    return existing.length > 0;
  } catch (err) {
    log('warn', 'Erro ao verificar dedup', {
      affiliateId,
      originalUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

// ─── Source Group Config (1:N cache) ─────────────────────────────────

let redisClient: Redis | null = null;

function getRedis(): Redis | null {
  if (redisClient) return redisClient;

  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });
  } catch {
    return null;
  }

  return redisClient;
}

async function getSourceGroupConfigs(sourceGroupJid: string): Promise<SourceGroupConfig[]> {
  const r = getRedis();
  if (!r) return [];

  try {
    const key = `${MIRROR_SOURCE_GROUP_CACHE_PREFIX}${sourceGroupJid}`;
    const raw = await r.get(key);
    if (!raw) return [];

    const configs = JSON.parse(raw) as SourceGroupConfig[];
    return Array.isArray(configs) ? configs : [];
  } catch {
    return [];
  }
}

// ─── Conversion ──────────────────────────────────────────────────────

async function convertOfferUrl(
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
    return { convertedUrl: null, marketplace: effectiveMarketplace, success: false, error: String(err) };
  }
}

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
    if (mlAffiliate.sessionCookies) {
      const shortResult = await generateShortAffiliateLink(
        url,
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

      if (
        shortResult.error?.includes('HTTP 40') ||
        shortResult.error?.includes('Cookies podem estar expirados')
      ) {
        const instanceName = `user-${userId}`;
        processFailure(instanceName, 'cookie_expired', { marketplace: 'mercadolivre' }).catch(() => {});
      } else {
        return {
          convertedUrl: null,
          marketplace: 'mercadolivre',
          success: false,
          error: shortResult.error,
        };
      }
    }

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
        meliid: mlAffiliate.meliid ?? undefined,
        melitat: mlAffiliate.melitat,
      });

      return {
        convertedUrl: affiliateUrl,
        marketplace: 'mercadolivre',
        success: true,
      };
    } catch (err) {
      return {
        convertedUrl: null,
        marketplace: 'mercadolivre',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  log('info', 'Sem afiliado ML vinculado — usando fallback global', { userId });
  const instanceName = `user-${userId}`;
  processFailure(instanceName, 'ml_account_not_linked', { marketplace: 'mercadolivre' }).catch(() => {});

  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'mercadolivre',
    success: result.success,
    error: result.error,
  };
}

async function convertAmazonForAffiliate(
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

  if (creds?.amazonTrackingId) {
    const result = await convertAmazonUrlWithTrackingId(url, creds.amazonTrackingId);
    return {
      convertedUrl: result.affiliateUrl,
      marketplace: 'amazon',
      success: result.success,
      error: result.error,
    };
  }

  log('info', 'Sem tracking ID Amazon específico — usando fallback global', { userId });
  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'amazon',
    success: result.success,
    error: result.error,
  };
}

// ─── Template ────────────────────────────────────────────────────────

function buildTemplateMessage(
  ctx: TemplateContext,
  template: string | null,
): string {
  if (template) {
    const evalCtx = buildEvalContext(
      ctx.marketplace,
      ctx.sourceGroupName,
      ctx.targetGroupName,
    );
    let result = processConditionalsHuman(template, evalCtx);
    result = resolvePlaceholders(result, ctx);

    const maxLen = 4000;
    if (result.length > maxLen) {
      result = result.slice(0, maxLen - 50) + '...';
    }
    return result;
  }

  let text = ctx.originalText;
  if (ctx.convertedUrl) {
    text = text.replace(ctx.originalUrl, ctx.convertedUrl);
  }

  const maxLen = 4000;
  if (text.length > maxLen) {
    text = text.slice(0, maxLen - 50) + '...';
  }
  return text;
}

// ─── Affiliate Link Verification ─────────────────────────────────────

async function verifyAffiliateLink(
  convertedUrl: string | null,
  affiliateId: number,
  marketplace: string,
): Promise<{ valid: boolean; reason?: string }> {
  if (!convertedUrl) return { valid: true };

  try {
    if (marketplace === 'mercadolivre') {
      return await verifyMercadoLivreLink(convertedUrl, affiliateId);
    }
    if (marketplace === 'amazon') {
      return await verifyAmazonLink(convertedUrl, affiliateId);
    }
    return { valid: true };
  } catch (err) {
    log('warn', 'Erro ao verificar link de afiliado — permitindo por segurança', {
      affiliateId,
      marketplace,
      error: String(err),
    });
    return { valid: true };
  }
}

async function verifyMercadoLivreLink(
  convertedUrl: string,
  affiliateId: number,
): Promise<{ valid: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(convertedUrl);
  } catch {
    return { valid: false, reason: 'URL convertida inválida para verificação ML' };
  }

  const params = url.searchParams;
  const urlMeliid = params.get('meliid');
  const urlMelitat = params.get('melitat');
  const urlMattWord = params.get('matt_word');

  if (!urlMeliid && !urlMelitat && !urlMattWord) {
    return { valid: true };
  }

  const db = getDb();
  const affRows = await db
    .select({ evolutionInstanceId: affiliates.evolutionInstanceId })
    .from(affiliates)
    .where(eq(affiliates.id, affiliateId))
    .limit(1);

  if (!affRows[0]?.evolutionInstanceId) {
    return { valid: false, reason: 'Afiliado sem evolutionInstanceId' };
  }

  const userIdMatch = affRows[0].evolutionInstanceId.match(/^user-(\d+)$/);
  if (!userIdMatch) {
    return { valid: false, reason: 'evolutionInstanceId sem formato user-{userId}' };
  }

  const userId = parseInt(userIdMatch[1]!, 10);
  const mlRepo = new MlAffiliateRepository();
  const mlAffiliate = await mlRepo.findByPlatformUserId(userId);

  if (!mlAffiliate) {
    return { valid: false, reason: 'URL com parâmetros ML mas afiliado não vinculado' };
  }

  if (urlMelitat && mlAffiliate.melitat) {
    if (urlMelitat !== mlAffiliate.melitat) {
      return {
        valid: false,
        reason: `melitat não corresponde ao afiliado: esperado ${mlAffiliate.melitat}, recebido ${urlMelitat}`,
      };
    }
  } else if (urlMelitat && !mlAffiliate.melitat) {
    return { valid: false, reason: 'melitat presente na URL mas afiliado não possui melitat configurado' };
  }

  if (urlMattWord && mlAffiliate.melitat) {
    if (urlMattWord !== mlAffiliate.melitat) {
      return {
        valid: false,
        reason: `matt_word não corresponde ao afiliado: esperado ${mlAffiliate.melitat}, recebido ${urlMattWord}`,
      };
    }
  } else if (urlMattWord && !mlAffiliate.melitat) {
    return { valid: false, reason: 'matt_word presente na URL mas afiliado não possui melitat configurado' };
  }

  if (urlMeliid && mlAffiliate.meliid) {
    if (urlMeliid !== mlAffiliate.meliid) {
      return {
        valid: false,
        reason: `meliid não corresponde ao afiliado: esperado ${mlAffiliate.meliid}, recebido ${urlMeliid}`,
      };
    }
  }

  return { valid: true };
}

async function verifyAmazonLink(
  convertedUrl: string,
  affiliateId: number,
): Promise<{ valid: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(convertedUrl);
  } catch {
    return { valid: false, reason: 'URL convertida inválida para verificação Amazon' };
  }

  const urlTag = url.searchParams.get('tag');
  if (!urlTag) return { valid: true };

  const db = getDb();
  const affRows = await db
    .select({ evolutionInstanceId: affiliates.evolutionInstanceId })
    .from(affiliates)
    .where(eq(affiliates.id, affiliateId))
    .limit(1);

  if (!affRows[0]?.evolutionInstanceId) {
    return { valid: false, reason: 'Afiliado sem evolutionInstanceId' };
  }

  const userIdMatch = affRows[0].evolutionInstanceId.match(/^user-(\d+)$/);
  if (!userIdMatch) {
    return { valid: false, reason: 'evolutionInstanceId sem formato user-{userId}' };
  }

  const userId = parseInt(userIdMatch[1]!, 10);
  const credsRepo = new UserCredentialsRepository();
  const creds = await credsRepo.findByUserId(userId);

  if (creds?.amazonTrackingId) {
    if (urlTag !== creds.amazonTrackingId) {
      return {
        valid: false,
        reason: `Amazon tag não corresponde ao afiliado: esperado ${creds.amazonTrackingId}, recebido ${urlTag}`,
      };
    }
  }

  return { valid: true };
}

// ─── Log ─────────────────────────────────────────────────────────────

async function logReflectedOffer(params: {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string | null;
  marketplace: string;
  messagePreview: string;
  status: 'sent' | 'failed' | 'blocked';
  failureReason?: string;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(reflectedOffers).values({
      affiliateId: params.affiliateId,
      sourceGroupJid: params.sourceGroupJid,
      targetGroupJid: params.targetGroupJid,
      originalLink: params.originalLink,
      convertedLink: params.convertedLink ?? params.originalLink,
      marketplace: params.marketplace as 'shopee' | 'mercadolivre' | 'amazon' | 'unknown',
      messagePreview: params.messagePreview.slice(0, 500),
      status: params.status,
      failureReason: params.failureReason ?? null,
    });
  } catch (err) {
    log('error', 'Erro ao registrar reflected_offer', {
      error: String(err),
      ...params,
    });
  }
}

// ─── Pipeline Principal ──────────────────────────────────────────────

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

  // ── 1. Extrai URL ──
  const originalUrl = measureStepSync(steps.extract, () => extractMarketplaceUrl(text));
  if (!originalUrl) {
    log('info', 'Mensagem sem URL de marketplace — ignorada', { messageId });
    incrementCounter('pipeline_messages_blocked_total', { reason: 'no_url' });
    return true;
  }

  const marketplace = detectMarketplace(originalUrl);
  log('info', 'URL de marketplace detectada', { messageId, originalUrl, marketplace });

  // ── 2. Blacklist ──
  const blacklistTerms = await measureStep(steps.blacklist, async () => loadBlacklist());
  if (blacklistTerms.length > 0) {
    const textLower = text.toLowerCase();
    for (const term of blacklistTerms) {
      if (textLower.includes(term.toLowerCase())) {
        log('info', 'Mensagem filtrada pela blacklist', { messageId, term });
        incrementCounter('pipeline_messages_blocked_total', { reason: 'global_blacklist' });
        return true;
      }
    }
  }

  // ── 3. Whitelist ──
  const whitelistTerms = await measureStep(steps.whitelist, async () => loadWhitelist());
  if (whitelistTerms.length > 0) {
    const textLower = text.toLowerCase();
    const hasMatch = whitelistTerms.some((term) => textLower.includes(term.toLowerCase()));
    if (!hasMatch) {
      log('info', 'Mensagem filtrada pela whitelist', { messageId });
      incrementCounter('pipeline_messages_blocked_total', { reason: 'global_whitelist' });
      return true;
    }
  }

  // ── 4. Dedup 24h ── (via sourceGroup 1:N, usa o primeiro affiliate como proxy)
  // O dedup real é feito pelo send-dedup (Ingestor) e send-completed (Dispatcher)
  // Este passo é mantido como segurança extra
  const sourceConfigs = await getSourceGroupConfigs(sourceGroupJid);
  if (sourceConfigs.length === 0) {
    log('info', 'Nenhum afiliado configurado para este sourceGroup', { sourceGroupJid });
    return true;
  }

  // ── 5. Resolve redirect ──
  const resolvedUrl = await measureStep(steps.resolveRedirect, () => resolveRedirectUrl(originalUrl));

  // ── 6. Fetch product image ──
  const imageUrl = await measureStep(steps.imageFetch, () => fetchProductImage(marketplace, resolvedUrl));
  if (!imageUrl) {
    log('info', 'Imagem de produto não encontrada — bloqueado', { messageId, marketplace, resolvedUrl });
    incrementCounter('pipeline_messages_blocked_total', { reason: 'no_product_image' });
    incrementCounter('pipeline_image_fetch_total', { marketplace, result: 'not_found' });
    return true;
  }
  incrementCounter('pipeline_image_fetch_total', { marketplace, result: 'found' });

  // ── 7. Fan-out: para cada afiliado ──
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
        const sendDedupKey = `${MIRROR_SEND_DEDUP_PREFIX}${config.mirrorId}:${messageId}`;
        const alreadySent = await r.get(sendDedupKey);
        if (alreadySent) {
          log('info', 'SendEvent já publicado — pulando (crash recovery)', {
            mirrorId: config.mirrorId,
            messageId,
          });
          return null;
        }

        // Converte link com credenciais do afiliado
        const conversion = await convertOfferUrl(resolvedUrl, config.affiliateId, config.instanceName);
        if (!conversion.success) {
          incrementCounter('pipeline_messages_blocked_total', { reason: 'conversion_failed' });

          if (conversion.error) {
            const failureType = classifyConversionError(conversion.marketplace, conversion.error);
            if (failureType) {
              processFailure(config.instanceName, failureType, { marketplace: conversion.marketplace }).catch(() => {});
            }
          }
          return null;
        }

        // Verifica safety
        const linkCheck = await verifyAffiliateLink(
          conversion.convertedUrl,
          config.affiliateId,
          conversion.marketplace,
        );
        if (!linkCheck.valid) {
          incrementCounter('pipeline_messages_blocked_total', { reason: 'affiliate_link_mismatch' });
          return null;
        }

        // Cache a conversão bem-sucedida
        await setCachedConversion(resolvedUrl, {
          convertedUrl: conversion.convertedUrl,
          marketplace: conversion.marketplace,
          timestamp: new Date().toISOString(),
        });

        // Monta template
        const ctx: TemplateContext = {
          originalText: text,
          originalUrl,
          convertedUrl: conversion.convertedUrl,
          marketplace: conversion.marketplace,
          sourceGroupName: sourceGroupName || '(desconhecido)',
          targetGroupName: config.targetGroupName,
          timestamp: new Date(),
        };
        const templateText = buildTemplateMessage(ctx, config.messageTemplate);

        const sendEvent: SendEvent = {
          id: randomUUID(),
          sourceMessageId: messageId,
          sourceGroupJid,
          mirrorId: config.mirrorId,
          text: templateText,
          imageUrl,
          marketplace: conversion.marketplace,
          originalUrl,
          convertedUrl: conversion.convertedUrl!,
        };

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

  // ── 8. Publica na Queue B ──
  if (sendEvents.length > 0) {
    const pipeline = r.pipeline();
    for (const evt of sendEvents) {
      pipeline.xadd(MIRROR_SEND_STREAM, '*', 'payload', JSON.stringify(evt));
      // Marca send-dedup
      const sendDedupKey = `${MIRROR_SEND_DEDUP_PREFIX}${evt.mirrorId}:${messageId}`;
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

  // ── 9. ACK na Queue A ──
  const totalDuration = performance.now() - totalStart;
  steps.total.observe(totalDuration);

  log('info', 'Mensagem processada com sucesso', {
    messageId,
    durationMs: Math.round(totalDuration),
    sendEventsCount: sendEvents.length,
    affiliatesCount: sourceConfigs.length,
  });

  return true;
}

// ─── Init ────────────────────────────────────────────────────────────

export function initMetrics(): void {
  registerStepTrackers(steps);

  createCounter('pipeline_messages_received_total', 'Mensagens recebidas da Queue A');
  createCounter('pipeline_messages_blocked_total', 'Mensagens bloqueadas', ['reason']);
  createCounter('pipeline_affiliates_per_message', 'Afiliados por mensagem', ['count']);
  createCounter('pipeline_send_events_published_total', 'SendEvents publicados na Queue B', ['count']);
  createCounter('pipeline_image_fetch_total', 'Resultado da busca de imagem', ['marketplace', 'result']);
}