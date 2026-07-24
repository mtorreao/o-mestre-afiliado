/**
 * product-image.ts — Busca imagem de capa de produto por marketplace.
 *
 * Estratégia: código específico por marketplace, com fallback para og:image.
 * Imagem é OBRIGATÓRIA — se não encontrar, bloqueia a mensagem.
 *
 * Cache Redis:
 *   Chave: product-image:{sha256(url)}
 *   TTL: 1 hora (configurável via WORKER_IMAGE_CACHE_TTL)
 */

import { createHash } from 'node:crypto';
import Redis from 'ioredis';

// ─── Config ───────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';
const IMAGE_CACHE_TTL = parseInt(process.env.WORKER_IMAGE_CACHE_TTL || '3600', 10);
const IMAGE_FETCH_TIMEOUT_MS = 8_000;

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

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Busca og:image de uma página HTML via fetch.
 */
async function fetchOgImage(pageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const html = await res.text();
    // Busca og:image no meta
    const match = html.match(
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    );
    if (match?.[1]) return match[1];

    // Fallback: twitter:image
    const twMatch = html.match(
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    );
    if (twMatch?.[1]) return twMatch[1];

    return null;
  } catch {
    return null;
  }
}

// ─── Marketplace-specific extractors ───────────────────────────────────

/** Extrai item_id da URL da Shopee */
function extractShopeeItemId(url: string): string | null {
  const match = url.match(/\/product\/\d+\/(\d+)/i);
  return match?.[1] ?? null;
}

/** Extrai item_id da URL do Mercado Livre (MLB-XXXXXXXXXX) */
function extractMlItemId(url: string): string | null {
  const match = url.match(/ML[BMU]-\d+/i);
  return match?.[0] ?? null;
}

/** Extrai ASIN da URL da Amazon */
function extractAmazonAsin(url: string): string | null {
  // Formato: /dp/ASIN ou /gp/product/ASIN
  const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dpMatch?.[1]) return dpMatch[1];

  const gpMatch = url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  if (gpMatch?.[1]) return gpMatch[1];

  return null;
}

// ─── Implementações específicas ───────────────────────────────────────

async function fetchShopeeImage(productUrl: string): Promise<string | null> {
  const itemId = extractShopeeItemId(productUrl);
  if (!itemId) return null;

  // Tenta og:image da página do produto
  const ogImage = await fetchOgImage(productUrl);
  if (ogImage) return ogImage;

  return null;
}

async function fetchMercadoLivreImage(productUrl: string): Promise<string | null> {
  const itemId = extractMlItemId(productUrl);
  if (!itemId) return null;

  // Tenta API pública do ML
  try {
    const res = await fetch(`https://api.mercadolibre.com/items/${itemId}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      const data = await res.json() as { pictures?: Array<{ url: string }> };
      if (data.pictures?.[0]?.url) return data.pictures[0].url;
    }
  } catch {
    // fallback para og:image
  }

  // Fallback: og:image da página
  return fetchOgImage(productUrl);
}

async function fetchAmazonImage(productUrl: string): Promise<string | null> {
  const asin = extractAmazonAsin(productUrl);
  if (!asin) return null;

  // Tenta og:image (Amazon pode bloquear — usar user-agent de browser)
  return fetchOgImage(productUrl);
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
      // Tenta og:image genérico
      imageUrl = await fetchOgImage(productUrl);
  }

  // Cache o resultado (mesmo null — evita re-fetch)
  await setCachedImage(productUrl, imageUrl);

  return imageUrl;
}