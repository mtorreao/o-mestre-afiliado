/**
 * product-image-pure.ts — Lógica PURA (sem I/O) da busca de imagem de produto.
 *
 * Extraída de product-image.ts para permitir 100% de cobertura via testes
 * unitários, sem rede/DB/Redis. A camada de I/O (fetch, Redis, repositórios)
 * vive em `product-image.ts`, que importa e delega para este módulo.
 *
 * IMPORTANTE: NÃO importar de `product-image.ts` aqui (circular import).
 */
import { createHash } from 'node:crypto';

// ─── Cache (chave + payload) ──────────────────────────────────────────

export function productImageCacheKey(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex');
  return `product-image:${hash}`;
}

export interface CachedImage {
  imageUrl: string | null;
  fetchedAt: string;
}

/**
 * Faz o parse tolerante do valor bruto do Redis. Retorna null para valores
 * ausentes ou JSON inválido (mesma semântica do try/catch original).
 */
export function parseCachedImage(raw: string | null | undefined): CachedImage | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedImage;
  } catch {
    return null;
  }
}

/**
 * Serializa o payload de cache. `fetchedAt` é injetado para manter a função
 * determinística em teste (o caller passa new Date().toISOString()).
 */
export function buildCachedImagePayload(imageUrl: string | null, fetchedAt: string): string {
  return JSON.stringify({ imageUrl, fetchedAt } satisfies CachedImage);
}

// ─── Extração de imagem de HTML ───────────────────────────────────────

/**
 * Extrai og:image/twitter:image de um HTML, tolerante à ordem de
 * atributos (property antes ou depois de content) e a aspas simples.
 */
export function extractOgImage(html: string): string | null {
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
export function extractAmazonDynamicImage(html: string): string | null {
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

/** Resolve uma URL possivelmente relativa contra a página de origem. */
export function toAbsolute(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

/** og:image/twitter:image de um HTML como URL absoluta. */
export function extractOgImageFromHtml(html: string, baseUrl: string): string | null {
  const image = extractOgImage(html);
  return image ? toAbsolute(image, baseUrl) : null;
}

/**
 * Extrai a primeira URL de imagem "de produto" de um HTML, cobrindo:
 *   - og:image / twitter:image
 *   - data-a-dynamic-image (Amazon)
 * Retorna URL absoluta quando possível.
 */
export function extractAnyProductImage(html: string, baseUrl: string): string | null {
  const og = extractOgImageFromHtml(html, baseUrl);
  if (og) return og;

  const amazon = extractAmazonDynamicImage(html);
  if (amazon) return toAbsolute(amazon, baseUrl);

  return null;
}

// ─── Extração de IDs por marketplace ──────────────────────────────────

/**
 * Extrai o itemId (número do item na Shopee) de uma URL.
 * Suporta os formatos -i.SHOPID.ITEMID, /product/SHOPID/ITEMID e
 * /opaanlp/SHOPID/ITEMID (novo formato de short link da Shopee).
 */
export function extractShopeeItemId(url: string): string | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[2]) return m[2];
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[2]) return productMatch[2];
  const opaanlpMatch = url.match(/\/opaanlp\/(\d+)\/(\d+)/i);
  if (opaanlpMatch?.[2]) return opaanlpMatch[2];
  return null;
}

/**
 * Extrai o shopId (vendedor) de uma URL Shopee.
 * Suporta os formatos -i.SHOPID.ITEMID, /product/SHOPID/ITEMID e
 * /opaanlp/SHOPID/ITEMID (novo formato de short link da Shopee).
 */
export function extractShopeeShopId(url: string): string | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[1]) return m[1];
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[1]) return productMatch[1];
  const opaanlpMatch = url.match(/\/opaanlp\/(\d+)\/(\d+)/i);
  if (opaanlpMatch?.[1]) return opaanlpMatch[1];
  return null;
}

/**
 * Extrai o slug (parte textual) de uma URL Shopee.
 * Ex: shopee.com.br/Capinha-iPhone-i.123.456 → "Capinha-iPhone"
 */
export function extractShopeeSlug(url: string): string | null {
  const m = url.match(/shopee\.com\.br\/([^/?#]+)-i\./i);
  if (m?.[1]) return m[1];
  const m2 = url.match(/shopee\.com\.br\/([^/?#]+)/i);
  if (m2?.[1] && !m2[1].startsWith('product')) return m2[1];
  return null;
}

/** Extrai item_id da URL do Mercado Livre (MLB-XXXXXXXXXX) */
export function extractMlItemId(url: string): string | null {
  const match = url.match(/ML[BMU]-\d+/i);
  return match?.[0] ?? null;
}

/** Extrai ASIN da URL da Amazon */
export function extractAmazonAsin(url: string): string | null {
  const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dpMatch?.[1]) return dpMatch[1];
  const gpMatch = url.match(/\/gp\/product\/([A-Z0-9]{10})/i);
  if (gpMatch?.[1]) return gpMatch[1];
  return null;
}

// ─── Construção de URLs de fallback (CDN/API) ─────────────────────────

/** Candidatos de CDN público da Shopee para um itemId. */
export function buildShopeeCdnCandidates(itemId: string): string[] {
  return [
    `https://cf.shopee.com.br/file/${itemId}_tn`,
    `https://down-br.img.susercontent.com/file-${itemId}_tn`,
  ];
}

/** Candidatos de CDN público da Amazon para um ASIN. */
export function buildAmazonCdnCandidates(asin: string): string[] {
  return [
    `https://m.media-amazon.com/images/P/${asin}.01._SCRM_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCRM_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._AC_SCRM_.jpg`,
    `https://images-na.ssl-images-amazon.com/images/P/${asin}.01.LZZZZZZZ.jpg`,
  ];
}

/** URL da API pública do ML para um item. */
export function buildMlItemApiUrl(itemId: string): string {
  return `https://api.mercadolibre.com/items/${itemId}`;
}

/** URL canônica /dp/{ASIN} da Amazon BR. */
export function buildAmazonDpUrl(asin: string): string {
  return `https://www.amazon.com.br/dp/${asin}`;
}

/** Extrai a primeira picture do payload da API pública do ML. */
export function extractMlApiImage(
  data: { pictures?: Array<{ url: string }> } | null | undefined,
): string | null {
  return data?.pictures?.[0]?.url ?? null;
}

// ─── Helpers HTTP puros ───────────────────────────────────────────────

/** content-type de imagem válido (image/*)? */
export function isImageContentType(contentType: string | null | undefined): boolean {
  return (contentType ?? '').startsWith('image/');
}

export function ensureHttps(url: string): string {
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return url.replace(/^http:\/\//, 'https://');
  return url;
}

// ─── Log estruturado (construção pura do entry) ───────────────────────

export interface ImageStrategyLogEntry {
  timestamp: string;
  level: 'info' | 'debug';
  service: 'product-image';
  message: string;
  marketplace: string;
  productUrl: string;
  imageUrl?: string;
  strategy?: string;
}

/**
 * Monta o entry JSON de log de estratégia de imagem. `timestamp` é injetado
 * para manter a função determinística em teste.
 */
export function buildImageStrategyLogEntry(
  marketplace: string,
  strategy: string,
  url: string,
  imageUrl: string | null,
  timestamp: string,
): ImageStrategyLogEntry {
  if (imageUrl) {
    return {
      timestamp,
      level: 'info',
      service: 'product-image',
      message: `Imagem encontrada (${strategy})`,
      marketplace,
      productUrl: url,
      imageUrl,
      strategy,
    };
  }
  return {
    timestamp,
    level: 'debug',
    service: 'product-image',
    message: `Estratégia ${strategy} falhou`,
    marketplace,
    productUrl: url,
  };
}
