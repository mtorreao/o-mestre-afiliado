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
 */

import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { getProductOffer } from '@omestre/converters';
import { UserCredentialsRepository } from '@omestre/db';

// ─── Config ───────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const IMAGE_CACHE_TTL = parseInt(process.env.WORKER_IMAGE_CACHE_TTL || '3600', 10);
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
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

function urlToCacheKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return `product-image:${hash}`;
}

interface CachedImage {
  imageUrl: string | null;
  fetchedAt: string;
}

async function getCachedImage(url: string): Promise<CachedImage | null> {
  const r = getImageCacheRedis();
  if (!r) return null;

  try {
    const raw = await r.get(urlToCacheKey(url));
    if (!raw) return null;
    return JSON.parse(raw) as CachedImage;
  } catch {
    return null;
  }
}

async function setCachedImage(url: string, imageUrl: string | null): Promise<void> {
  const r = getImageCacheRedis();
  if (!r) return;

  try {
    await r.setex(
      urlToCacheKey(url),
      IMAGE_CACHE_TTL,
      JSON.stringify({ imageUrl, fetchedAt: new Date().toISOString() }),
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
async function fetchOgImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const finalUrl = res.url || pageUrl;
    const html = await res.text();

    // og:image (ou twitter:image) — cobre a maioria dos marketplaces.
    // Amazon não expõe og:image para bots; usa data-a-dynamic-image.
    const image = extractAnyProductImage(html, finalUrl);
    return image;
  } catch {
    return null;
  }
}

/**
 * Extrai og:image/twitter:image de um HTML, tolerante à ordem de
 * atributos (property antes ou depois de content) e a aspas simples.
 */
function extractOgImage(html: string): string | null {
  const patterns = [
    // property/name antes de content
    /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*?content=["']([^"']+)["']/i,
    // content antes de property/name
    /<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["'](?:og:image|twitter:image)["']/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const value = m[1].trim();
      // Alguns sites colocam múltiplas URLs separadas por vírgula/espaço
      const first = value.split(/[,\s]+/)[0]!;
      if (first.startsWith('http') || first.startsWith('/')) return first;
    }
  }

  return null;
}

/**
 * Amazon embute as imagens do produto em um atributo
 * `data-a-dynamic-image='{"https://...jpg":[w,h],...}'` (JSON com
 * entidades HTML escapadas). og:image costuma estar ausente para bots.
 */
function extractAmazonDynamicImage(html: string): string | null {
  const m = html.match(/data-a-dynamic-image=["']([^"']+)["']/i);
  if (!m?.[1]) return null;

  try {
    const decoded = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const obj = JSON.parse(decoded) as Record<string, unknown>;
    const keys = Object.keys(obj);
    // Pega a maior (primeira chave geralmente é a imagem principal)
    for (const k of keys) {
      if (/^https?:\/\//.test(k)) return k;
    }
  } catch {
    // ignora JSON inválido
  }
  return null;
}

/**
 * Extrai a primeira URL de imagem “de produto” de um HTML, cobrindo:
 *   - og:image / twitter:image
 *   - data-a-dynamic-image (Amazon)
 *   - <img> com src de domínio de imagem conhecido
 * Retorna URL absoluta quando possível.
 */
function extractAnyProductImage(html: string, baseUrl: string): string | null {
  const og = extractOgImage(html);
  if (og) return toAbsolute(og, baseUrl);

  const amazon = extractAmazonDynamicImage(html);
  if (amazon) return toAbsolute(amazon, baseUrl);

  return null;
}

function toAbsolute(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
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
  if (imageUrl) {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'info',
      service: 'product-image',
      message: `Imagem encontrada (${strategy})`,
      marketplace,
      productUrl: url,
      imageUrl,
      strategy,
    }));
  } else {
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'debug',
      service: 'product-image',
      message: `Estratégia ${strategy} falhou`,
      marketplace,
      productUrl: url,
    }));
  }
}

/**
 * Extrai o itemId (número do item na Shopee) de uma URL.
 * Suporta tanto o formato -i.SHOPID.ITEMID quanto /product/SHOPID/ITEMID.
 */
function extractShopeeItemId(url: string): string | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[2]) return m[2];
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[2]) return productMatch[2];
  return null;
}

/**
 * Extrai o shopId (vendedor) de uma URL Shopee.
 * Suporta tanto o formato -i.SHOPID.ITEMID quanto /product/SHOPID/ITEMID.
 */
function extractShopeeShopId(url: string): string | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[1]) return m[1];
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[1]) return productMatch[1];
  return null;
}

/**
 * Extrai o slug (parte textual) de uma URL Shopee.
 * Ex: shopee.com.br/Capinha-iPhone-i.123.456 → "Capinha-iPhone"
 */
function extractShopeeSlug(url: string): string | null {
  const m = url.match(/shopee\.com\.br\/([^/?#]+)-i\./i);
  if (m?.[1]) return m[1];
  const m2 = url.match(/shopee\.com\.br\/([^/?#]+)/i);
  if (m2?.[1] && !m2[1].startsWith('product')) return m2[1];
  return null;
}

/** Extrai item_id da URL do Mercado Livre (MLB-XXXXXXXXXX) */
function extractMlItemId(url: string): string | null {
  const match = url.match(/ML[BMU]-\d+/i);
  return match?.[0] ?? null;
}

/** Extrai ASIN da URL da Amazon */
function extractAmazonAsin(url: string): string | null {
  const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dpMatch?.[1]) return dpMatch[1];
  const gpMatch = url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  if (gpMatch?.[1]) return gpMatch[1];
  return null;
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
    const cdnCandidates = [
      `https://cf.shopee.com.br/file/${itemId}_tn`,
      `https://down-br.img.susercontent.com/file-${itemId}_tn`,
    ];
    for (const cdn of cdnCandidates) {
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

async function fetchMercadoLivreImage(productUrl: string): Promise<string | null> {
  const itemId = extractMlItemId(productUrl);

  // Se temos o item_id, a API pública do ML é a fonte mais confiável.
  if (itemId) {
    try {
      const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { pictures?: Array<{ url: string }> };
        if (data.pictures?.[0]?.url) return data.pictures[0].url;
      }
    } catch {
      // fallback para og:image
    }
  }

  // Fallback principal: og:image da página (meli.la → redireciona p/ produto).
  return fetchOgImage(productUrl);
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
    const ogByAsin = await fetchOgImage(`https://www.amazon.com.br/dp/${asin}`);
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
    const cdnCandidates = [
      `https://m.media-amazon.com/images/P/${asin}.01._SCRM_.jpg`,
      `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCRM_.jpg`,
      `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._AC_SCRM_.jpg`,
      `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`,
    ];
    for (const cdn of cdnCandidates) {
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

    const contentType = res.headers.get('content-type') || '';
    return contentType.startsWith('image/');
  } catch {
    return false;
  }
}

function ensureHttps(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return url.replace(/^http:\/\//, 'https://');
  return url;
}

// ─── API Pública ──────────────────────────────────────────────────────

export async function fetchProductImage(
  marketplace: string,
  productUrl: string,
): Promise<string | null> {
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
      imageUrl = await fetchMercadoLivreImage(productUrl);
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
    imageUrl = await fetchOgImage(productUrl);
  }

  // Cache o resultado (mesmo null — evita re-fetch).
  await setCachedImage(productUrl, imageUrl);

  return imageUrl;
}
