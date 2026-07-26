/**
 * Ingestor — Pipeline de processamento de mensagens cruas.
 *
 * Fluxo:
 *   0. Sanitização: remove links não-oferta (t.me/*) do texto
 *   1. Extrai URLs de marketplace do texto sanitizado
 *   2. Resolve TODOS os links (multi-link) e classifica:
 *      - product:     URL final é página de produto → vai pro Link Builder
 *      - informative: URL final é campanha/listagem → mantida no texto
 *      - discard:     não resolveu → removida do texto
 *   3. Seleciona a URL de produto (bloqueia se 0 ou ≥2)
 *   4. Reconstrói o texto com URLs resolvidas
 *   5. Blacklist global
 *   6. Whitelist global
 *   7. Busca configs do sourceGroup (cache 1:N)
 *   8. Fan-out por afiliado (paralelo):
 *      a. Converte link com credenciais do afiliado (só produto)
 *      b. Verifica link (safety check)
 *      c. Monta template (texto sanitizado + URLs resolvidas)
 *      d. Publica SendEvent na Queue B
 *   9. Fetch product image (opcional, fallback texto)
 *   10. Publica na Queue B
 *   11. ACK na Queue A
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
  generateShortAffiliateLink,
  convertAmazonUrlWithAffiliate,
} from '@omestre/converters';
import {
  getDb,
  affiliates,
  mirrors,
  reflectedOffers,
  UserCredentialsRepository,
  MlAffiliateRepository,
  AmazonAffiliateRepository,
  MirrorRepository,
} from '@omestre/db';
import { eq, and, gte } from 'drizzle-orm';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'fs';
import { resolveRedirectUrl, resolveMeliRedirect, isMeliProductUrl } from './resolve-redirect.ts';
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

/**
 * Tipo de link de marketplace extraído de uma mensagem.
 * - 'product': URL de página de PRODUTO (tem padrão de item claro)
 * - 'coupon':  link de CUPOM / voucher / redirector de afiliado
 * - 'other':   marketplace detectado mas sem padrão de produto claro
 *              (ex.: shortlink s.shopee.com.br não resolvido)
 */
type LinkKind = 'product' | 'coupon' | 'other';

interface ExtractedLink {
  url: string;
  kind: LinkKind;
}

/**
 * Classifica um link de marketplace em produto / cupom / outro.
 * Usa padrões de URL — NÃO resolve redirects (economia de rede).
 */
export function classifyLinkKind(url: string): LinkKind {
  // Redirector de cupom conhecido (go.promozone.ai/*) sempre é cupom
  if (/go\.promozone\.ai/i.test(url)) return 'coupon';
  // Shortlinks Shopee (s.shopee.com.br/XXX) — affiliate/cupom/voucher:
  // não temos como saber se é produto sem resolver o redirect (que é
  // feito em outro passo). Marcamos como 'coupon' para que o pipeline
  // não tente extrair imagem do shortlink e não use o shortlink como
  // originalLink no dedup. O `resolveRedirectUrl` depois, se conseguir
  // extrair um itemId real, promove a URL para o caminho de produto.
  if (/s\.shopee\.com\.br/i.test(url)) return 'coupon';
  // URLs de cupom/voucher óbvias
  if (/voucher-wallet|cupom|\/claim\b|\/coupons?\b|\/voucher\b/i.test(url)) return 'coupon';
  // Shopee produto: -i.SHOPID.ITEMID (o "i." pode vir após slug com hífen;
  // ITEMID e SHOPID são separados por ponto na URL real)
  if (/(^|[\/-])i\.\d+[./]\d+/i.test(url)) return 'product';
  // MercadoLivre produto: MLBxxxx, /p/MLB, meli.la (oferta ML)
  if (/(^|\/|\.)(MLB|MLM|MLA|MCO|MLC)\d{8,}/i.test(url) || /\/p\/MLB/i.test(url) || /meli\.la\//i.test(url)) return 'product';
  // Amazon produto: /dp/ASIN ou /gp/product/ASIN
  if (/\/dp\/[A-Z0-9]{10}/i.test(url) || /\/gp\/product\/[A-Z0-9]{10}/i.test(url)) return 'product';
  // Demais (s.shopee.com.br shortlink não resolvido, magalu, etc.)
  return 'other';
}

/**
 * Extrai TODOS os links de marketplace de um texto, classificando cada um.
 * Substitui extractMarketplaceUrl (que pegava só o primeiro).
 */
export function extractAllMarketplaceLinks(text: string): ExtractedLink[] {
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const urls = text.match(urlRegex);
  if (!urls) return [];

  const result: ExtractedLink[] = [];
  for (const url of urls) {
    const marketplace = detectMarketplace(url);
    if (marketplace === 'unknown') continue;
    result.push({ url, kind: classifyLinkKind(url) });
}
  return result;
}

/**
 * Extrai a URL de marketplace da mensagem (compatibilidade).
 * Pega o primeiro link não-cupom — mantém o comportamento antigo para
 * chamadores que não tratam múltiplos links.
 */
function extractMarketplaceUrl(text: string): string | null {
  const links = extractAllMarketplaceLinks(text);
  if (links.length === 0) return null;
  const nonCoupon = links.find((l) => l.kind !== 'coupon');
  return (nonCoupon ?? links[0]!).url;
}

/**
 * Remove links que não fazem parte da oferta do texto.
 * Atualmente remove links de Telegram (t.me/*) — canais/grupos que são
 * divulgação do bot original, não parte da oferta em si.
 *
 * Exemplo: "#MercadoLivre #Parceria | t.me/cuponsm"
 *       →  "#MercadoLivre #Parceria"
 */
function sanitizeNonOfferLinks(text: string): string {
  // Remove URLs de Telegram (t.me/*)
  let sanitized = text.replace(/https?:\/\/t\.me\/[^\s<>"']+/gi, '');
  // Remove separadores órfãos no final de linha (ex.: "| " sem link)
  sanitized = sanitized.replace(/\s*\|\s*$/gm, '');
  // Limpa espaços extras
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ');
  // Remove linhas vazias extras
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
  return sanitized.trim();
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

    const parsed = JSON.parse(raw);
    const configs = Array.isArray(parsed) ? parsed : [parsed];
    
    // Filtra apenas configs completos (com instanceName)
    return configs.filter((c: SourceGroupConfig) => c.instanceName && c.targetGroupJid);
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
    const isProduct = isProductFromRedirect
      ? resolved.isProduct
      : isMeliProductUrl(resolved.url);
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
      processFailure(instanceName, 'cookie_expired', { marketplace: 'mercadolivre' }).catch(() => {});
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
  processFailure(instanceName, 'ml_account_not_linked', { marketplace: 'mercadolivre' }).catch(() => {});

  return {
    convertedUrl: null,
    marketplace: 'mercadolivre',
    success: false,
    error: 'Afiliado ML sem tag (melitat) configurada. Reimporte os cookies pela extensão Chrome.',
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
  const amazonRepo = new AmazonAffiliateRepository();
  const amazonAffiliate = await amazonRepo.findByUserId(userId);

  if (amazonAffiliate && (amazonAffiliate.trackingIds ?? []).length > 0) {
    const result = await convertAmazonUrlWithAffiliate(
      url,
      amazonAffiliate.trackingIds ?? [],
    );
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
  const amazonRepo = new AmazonAffiliateRepository();
  const amazonAffiliate = await amazonRepo.findByUserId(userId);

  if (amazonAffiliate && (amazonAffiliate.trackingIds ?? []).length > 0) {
    const activeTags = (amazonAffiliate.trackingIds ?? [])
      .filter((t) => t.active)
      .map((t) => t.tag);
    if (urlTag && !activeTags.includes(urlTag)) {
      return {
        valid: false,
        reason: `Amazon tag não corresponde ao afiliado: esperado um de [${activeTags.join(', ')}], recebido ${urlTag}`,
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

  // ── 0. Sanitização: remove links que não são da oferta ──
  // Links de Telegram (t.me/*) são divulgação do bot original, não fazem
  // parte da oferta. Removidos ANTES da extração para não poluir o pipeline.
  const sanitizedText = sanitizeNonOfferLinks(text);

  // ── 1. Extrai URLs de marketplace ──
  // Mensagens podem trazer MAIS DE UM link (ex.: produto + cupom + campanha).
  // Regra: se houver ≥2 links de PRODUTO, bloqueia (nunca deveria ter 2
  // produtos na mesma oferta). Links informativos (campanha, cupom) são
  // resolvidos e mantidos no texto, mas NÃO vão para o Link Builder.
  const extractedLinks = measureStepSync(steps.extract, () => extractAllMarketplaceLinks(sanitizedText));
  if (extractedLinks.length === 0) {
    log('info', 'Mensagem sem URL de marketplace — ignorada', { messageId });
    incrementCounter('pipeline_messages_blocked_total', { reason: 'no_url' });
    return true;
  }

  const productLinks = extractedLinks.filter((l) => l.kind === 'product');
  const couponLinks = extractedLinks.filter((l) => l.kind === 'coupon');

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
      resolvedLinks.push({ originalUrl: link.url, resolvedUrl: resolved, role: 'discard', marketplace: 'unknown' });
      continue;
    }

    // Classifica o destino resolvido
    const isProduct =
      resolvedMarketplace === 'shopee'
        ? /-i\.\d+\.\d+/i.test(resolved)
        : resolvedMarketplace === 'mercadolivre'
          ? isMeliProductUrl(resolved)
          : resolvedMarketplace === 'amazon'
            ? /\/dp\/[A-Z0-9]{10}/i.test(resolved) || /\/gp\/product\/[A-Z0-9]{10}/i.test(resolved)
            : false;

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

  // ── 3.5. Resolução de /social/<id> → produto real ──
  // Páginas /social/<id> do ML são social commerce: o Link Builder rejeita
  // essas URLs (erro 111). Precisamos extrair a URL real do produto (/p/MLB<id>)
  // navegando na página e clicando em "Ir para o Produto".
  if (marketplace === 'mercadolivre' && /^\/social\/[a-zA-Z0-9]+\/?$/i.test(new URL(resolvedUrl).pathname)) {
    const { resolveSocialProductUrl } = await import('./resolve-social-product.ts');
    const realProductUrl = await resolveSocialProductUrl(resolvedUrl);
    if (realProductUrl) {
      log('info', '/social/ resolvido para produto real', {
        messageId,
        socialUrl: resolvedUrl,
        productUrl: realProductUrl,
      });
      resolvedUrl = realProductUrl;
    } else {
      log('warn', '/social/ não pôde ser resolvido para produto — tentando Link Builder mesmo assim', {
        messageId,
        socialUrl: resolvedUrl,
      });
    }
  }

  // ── 4. Reconstrução do texto ──
  // Substitui URLs originais pelas resolvidas no texto sanitizado:
  //   - Produto: será substituído pela URL convertida no template (passo 6)
  //   - Informativo: substituído pela URL resolvida (ex.: /sec/ → /ofertas)
  //   - Descartado: removido do texto
  let processedText = sanitizedText;
  for (const rl of resolvedLinks) {
    if (rl.role === 'informative') {
      processedText = processedText.replace(rl.originalUrl, rl.resolvedUrl);
    } else if (rl.role === 'discard') {
      // Remove o link e separadores órfãos
      processedText = processedText.replace(rl.originalUrl, '');
    }
    // 'product' não é substituído aqui — será substituído pela URL convertida
    // no template (buildTemplateMessage faz text.replace(originalUrl, convertedUrl))
  }
  // Limpa espaços/separadores órfãos após remoções
  processedText = processedText.replace(/\s*\|\s*$/gm, '');
  processedText = processedText.replace(/[ \t]{2,}/g, ' ');
  processedText = processedText.replace(/\n{3,}/g, '\n\n');
  processedText = processedText.trim();

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
    const textLower = sanitizedText.toLowerCase();
    for (const term of blacklistTerms) {
      if (textLower.includes(term.toLowerCase())) {
        log('info', 'Mensagem filtrada pela blacklist', { messageId, term });
        incrementCounter('pipeline_messages_blocked_total', { reason: 'global_blacklist' });
        return true;
      }
    }
  }

  // ── 6. Whitelist ──
  const whitelistTerms = await measureStep(steps.whitelist, async () => loadWhitelist());
  if (whitelistTerms.length > 0) {
    const textLower = sanitizedText.toLowerCase();
    const hasMatch = whitelistTerms.some((term) => textLower.includes(term.toLowerCase()));
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

        // Monta template — usa processedText (texto sanitizado + URLs resolvidas)
        const ctx: TemplateContext = {
          originalText: processedText,
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
          imageUrl: '', // preenchido abaixo, após o fan-out (busca única)
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
    imageUrl = await measureStep(steps.imageFetch, () => fetchProductImage(marketplace, resolvedUrl)) || '';
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

  // ── 11. ACK na Queue A ──
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
  createCounter('pipeline_image_missing_fallback_total', 'Ofertas enviadas como texto (sem imagem)', ['marketplace']);
}