/**
 * product-image.ts — Busca imagem de capa de produto por marketplace.
 *
 * Estratégia por marketplace (cascata, da mais confiável para menos):
 *   - Shopee:
 *       1. GraphQL Affiliate API productOfferV2 (itemId+shopId) — usa credenciais
 *       2. GraphQL Affiliate API productOfferV2 (keyword=slug) — usa credenciais
 *       3. og:image / twitter:image da página (Shopee é quase 100% CSR, então
 *          normalmente cai para os próximos)
 *       4. Tentativa direta no CDN Shopee (técnica de URL pública)
 *
 *   - Mercado Livre:
 *       1. api.mercadolibre.com/items/{id} → pictures[0].url (API pública)
 *       2. og:image da página (meli.la → redireciona)
 *
 *   - Amazon:
 *       1. og:image da página /dp/{ASIN}
 *       2. data-a-dynamic-image do HTML
 *       3. CDN direto: https://images-na.ssl-images-amazon.com/images/P/{ASIN}.01._SCRM_.jpg
 *
 * Imagem é OBRIGATÓRIA — se não encontrar, bloqueia a mensagem.
 *
 * Cache Redis:
 *   Chave: product-image:{sha256(url)}
 *   TTL: 1 hora (configurável via WORKER_IMAGE_CACHE_TTL)
 *
 * Toda a lógica PURA (parse/extração/construção de URL) vive em
 * `product-image-pure.ts` (coberta por product-image-pure.test.ts).
 */

import Redis from 'ioredis';
import { getProductOffer } from '@omestre/converters';
import { UserCredentialsRepository } from '@omestre/db';
import type { CachedImage } from './product-image-pure.ts';
import {
  productImageCacheKey,
  parseCachedImage,
  buildCachedImagePayload,
  extractAnyProductImage,
  extractShopeeItemId,
  extractMlItemId,
  extractAmazonAsin,
  buildShopeeCdnCandidates,
  buildAmazonCdnCandidates,
  buildMlItemApiUrl,
  buildAmazonDpUrl,
  extractMlApiImage,
  isImageContentType,
  ensureHttps,
  buildImageStrategyLogEntry,
} from './product-image-pure.ts';

// Re-export das puras para compatibilidade com consumidores/testes antigos.
export {
  productImageCacheKey,
  extractOgImage,
  extractAmazonDynamicImage,
  extractOgImageFromHtml,
  extractShopeeItemId,
  extractShopeeShopId,
  extractShopeeSlug,
  extractMlItemId,
  extractAmazonAsin,
  ensureHttps,
} from './product-image-pure.ts';

// ─── Config ───────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const IMAGE_CACHE_TTL = parseInt(process.env.WORKER_IMAGE_CACHE_TTL || '3600', 10);
const PAGE_FETCH_TIMEOUT_MS = 8_000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ─── Redis cache ──────────────────────────────────────────────────────

let redis: Redis | null = null;
let cacheEnabled = true;

function getImageCacheRedis(): Redis | null {
  if (!cacheEnabled) return null;
  if (redis) return redis;

  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      retryStrategy(times) {
        if (times > 2) {
          cacheEnabled = false;
          return null;
        }
        return Math.min(times * 200, 1000);
      },
      lazyConnect: true,
    });

    redis.on('error', () => {
      cacheEnabled = false;
    });
  } catch {
    cacheEnabled = false;
    return null;
  }

  return redis;
}

async function getCachedImage(url: string): Promise<CachedImage | null> {
  const r = getImageCacheRedis();
  if (!r) return null;

  try {
    const raw = await r.get(productImageCacheKey(url));
    return parseCachedImage(raw);
  } catch {
    return null;
  }
}

async function setCachedImage(url: string, imageUrl: string | null): Promise<void> {
  const r = getImageCacheRedis();
  if (!r) return;

  try {
    await r.setex(
      productImageCacheKey(url),
      IMAGE_CACHE_TTL,
      buildCachedImagePayload(imageUrl, new Date().toISOString()),
    );
  } catch {
    // silencia
  }
}

// ─── Html fetch + og:image extraction ───────────────────────────────────

/**
 * Busca og:image (ou twitter:image) de uma página HTML.
 * Segue redirects automaticamente (redirect:'follow').
 * Retorna URL absoluta (resolve relativas contra a página de origem).
 */
async function fetchOgImage(pageUrl: string, cookies?: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
    };
    if (cookies) headers.Cookie = cookies;

    const res = await fetch(pageUrl, {
      method: 'GET',
      redirect: 'follow',
      headers,
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const finalUrl = res.url || pageUrl;
    const html = await res.text();

    // og:image (ou twitter:image) — cobre a maioria dos marketplaces.
    // Amazon não expõe og:image para bots; usa data-a-dynamic-image.
    return extractAnyProductImage(html, finalUrl);
  } catch {
    return null;
  }
}

// ─── Marketplace-specific extractors ───────────────────────────────────

/**
 * Log helper para identificar qual estratégia venceu.
 * Mantém um único ponto de log mesmo se mudarmos a estrutura.
 */
function logImageStrategy(
  marketplace: string,
  strategy: string,
  url: string,
  imageUrl: string | null,
): void {
  console.log(
    JSON.stringify(
      buildImageStrategyLogEntry(marketplace, strategy, url, imageUrl, new Date().toISOString()),
    ),
  );
}

// ─── Estratégia por marketplace ──────────────────────────────────────

/**
 * Shopee: cascata de 4 estratégias.
 *   1. productOfferV2 (itemId+shopId) — usa credenciais do afiliado
 *   2. productOfferV2 (keyword=slug) — fallback se itemId falhou
 *   3. og:image da página (CSR — quase nunca funciona)
 *   4. CDN Shopee direto: cf.shopee.com.br/file/{itemId}_tn
 */
async function fetchShopeeImage(productUrl: string): Promise<string | null> {
  // ── Estratégia 1+2: GraphQL Affiliate API ─
  // Tenta primeiro com credenciais do user-1 (afiliado padrão para o
  // ingestor). Se falhar, tenta sem credenciais (vai dar erro silencioso).
  const userId = 1;
  try {
    const credsRepo = new UserCredentialsRepository();
    const creds = await credsRepo.findByUserId(userId);
    if (creds?.shopeeAppId && creds?.shopeeAppSecret) {
      const offer = await getProductOffer(productUrl, {
        appId: creds.shopeeAppId,
        secret: creds.shopeeAppSecret,
      });
      if (offer?.imageUrl) {
        const imageUrl = ensureHttps(offer.imageUrl);
        logImageStrategy('shopee', 'graphql_productOfferV2', productUrl, imageUrl);
        return imageUrl;
      }
      logImageStrategy('shopee', 'graphql_productOfferV2', productUrl, null);
    }
  } catch {
    // silencioso — cai no próximo fallback
  }

  // ── Estratégia 3: og:image da página (Shopee CSR — baixa chance) ─
  const ogImage = await fetchOgImage(productUrl);
  if (ogImage) {
    logImageStrategy('shopee', 'og_image', productUrl, ogImage);
    return ogImage;
  }
  logImageStrategy('shopee', 'og_image', productUrl, null);

  // ── Estratégia 4: CDN Shopee direto ─
  // Formato público: https://cf.shopee.com.br/file/{itemId}_tn
  // Funciona quando o itemId é válido, mesmo sem renderizar a página.
  const itemId = extractShopeeItemId(productUrl);
  if (itemId) {
    for (const cdn of buildShopeeCdnCandidates(itemId)) {
      const ok = await checkImageUrl(cdn);
      if (ok) {
        logImageStrategy('shopee', 'cdn_direct', productUrl, cdn);
        return cdn;
      }
    }
    logImageStrategy('shopee', 'cdn_direct', productUrl, null);
  }

  return null;
}

async function fetchMercadoLivreImage(
  productUrl: string,
  sessionCookies?: string,
): Promise<string | null> {
  const itemId = extractMlItemId(productUrl);

  // Se temos o item_id, a API pública do ML é a fonte mais confiável.
  if (itemId) {
    try {
      const res = await fetch(buildMlItemApiUrl(itemId), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { pictures?: Array<{ url: string }> };
        const apiImage = extractMlApiImage(data);
        if (apiImage) return apiImage;
      }
    } catch {
      // fallback para og:image
    }
  }

  // Fallback autenticado: sem os cookies, o ML pode devolver /gz/account-verification.
  return fetchOgImage(productUrl, sessionCookies);
}

/**
 * Amazon: cascata de 3 estratégias.
 *   1. og:image da página /dp/{ASIN}
 *   2. data-a-dynamic-image do HTML
 *   3. CDN direto: https://images-na.ssl-images-amazon.com/images/P/{ASIN}.01._SCRM_.jpg
 *      (URL pública que pode ser acessada sem bot detection)
 */
async function fetchAmazonImage(productUrl: string): Promise<string | null> {
  const asin = extractAmazonAsin(productUrl);

  // Estratégia 1+2: og:image / data-a-dynamic-image
  if (asin) {
    const ogByAsin = await fetchOgImage(buildAmazonDpUrl(asin));
    if (ogByAsin) {
      logImageStrategy('amazon', 'og_image', productUrl, ogByAsin);
      return ogByAsin;
    }
    logImageStrategy('amazon', 'og_image', productUrl, null);
  }

  // Estratégia 3: CDN direto Amazon
  // A Amazon expõe imagens de produto em URLs públicas estáveis baseadas
  // no ASIN. O caminho `/images/P/{ASIN}.01._SCRM_.jpg` é usado pelo
  // próprio site para o "main image" e não requer autenticação.
  if (asin) {
    for (const cdn of buildAmazonCdnCandidates(asin)) {
      const ok = await checkImageUrl(cdn);
      if (ok) {
        logImageStrategy('amazon', 'cdn_direct', productUrl, cdn);
        return cdn;
      }
    }
    logImageStrategy('amazon', 'cdn_direct', productUrl, null);
  }

  return fetchOgImage(productUrl);
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Faz um HEAD request para verificar se uma URL de imagem existe e tem
 * content-type válido. Retorna true se a URL é uma imagem HTTP 200 OK.
 */
async function checkImageUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) return false;

    return isImageContentType(res.headers.get('content-type'));
  } catch {
    return false;
  }
}

// ─── API Pública ──────────────────────────────────────────────────────

export async function fetchProductImage(
  marketplace: string,
  productUrl: string,
  options: {
    preferredImageUrl?: string | null;
    sessionCookies?: string | null;
  } = {},
): Promise<string | null> {
  if (options.preferredImageUrl) {
    await setCachedImage(productUrl, options.preferredImageUrl);
    return options.preferredImageUrl;
  }

  // Cache check
  const cached = await getCachedImage(productUrl);
  if (cached) {
    return cached.imageUrl;
  }

  let imageUrl: string | null = null;

  switch (marketplace) {
    case 'shopee':
      imageUrl = await fetchShopeeImage(productUrl);
      break;
    case 'mercadolivre':
      imageUrl = await fetchMercadoLivreImage(productUrl, options.sessionCookies ?? undefined);
      break;
    case 'amazon':
      imageUrl = await fetchAmazonImage(productUrl);
      break;
    default:
      // Tenta og:image genérico (magalu, etc.)
      imageUrl = await fetchOgImage(productUrl);
  }

  // Fallback final: og:image genérico independente de marketplace.
  if (!imageUrl) {
    imageUrl = await fetchOgImage(productUrl, options.sessionCookies ?? undefined);
  }

  // Cache o resultado (mesmo null — evita re-fetch).
  await setCachedImage(productUrl, imageUrl);

  return imageUrl;
}
