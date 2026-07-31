/**
 * catalog-target — Resolução de identidade de produto por parse de URL (sem rede).
 *
 * Usado pelo Ingestor (publicação na Queue C) e pelo backfill do CatalogWorker:
 * dado `marketplace` + URL resolvida, extrai o `itemId` do marketplace e
 * monta a `productKey` de normalização (`${marketplace}:${itemId}`).
 *
 * Lógica 100% pura (regex sobre a URL) — nenhum I/O, nenhuma dependência.
 */

/** ItemId do Mercado Livre: prefixo de país + 8+ dígitos (MLB/MLM/MLA/MCO/MLC) */
const ML_ITEM_ID_RE = /(MLB|MLM|MLA|MCO|MLC)\d{8,}/i;

/** ASIN da Amazon: /dp/ASIN */
const AMAZON_ASIN_RE = /\/dp\/([A-Z0-9]{10})/i;

/** Identidade de produto resolvida por parse (sem rede). */
export interface CatalogTarget {
  marketplace: string;
  itemId: string;
  productKey: string;
}

/** Extrai o itemId (segundo número no padrão -i.SHOPID.ITEMID) de uma URL Shopee. */
export function extractShopeeItemIdFromUrl(url: string): number | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[2]) return parseInt(m[2], 10);
  // Tenta formato /product/{shopid}/{itemid}
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[2]) return parseInt(productMatch[2], 10);
  // Novo formato de short link: /opaanlp/{shopid}/{itemid}
  const opaanlpMatch = url.match(/\/opaanlp\/(\d+)\/(\d+)/i);
  if (opaanlpMatch?.[2]) return parseInt(opaanlpMatch[2], 10);
  return null;
}

/** Extrai o itemId do Mercado Livre (ex: MLB12345678901) de uma URL. */
export function extractMlItemIdFromUrl(url: string): string | null {
  const match = url.match(ML_ITEM_ID_RE);
  if (!match?.[0]) return null;
  return match[0].toUpperCase();
}

/** Extrai o ASIN da Amazon (formato /dp/ASIN) de uma URL. */
export function extractAmazonAsinFromUrl(url: string): string | null {
  const match = url.match(AMAZON_ASIN_RE);
  if (!match?.[1]) return null;
  return match[1].toUpperCase();
}

/**
 * Resolve `marketplace:itemId` por parse da URL resolvida (sem rede).
 * Retorna null quando o item não é normalizável (marketplace sem parser
 * ou ID ausente) — nesse caso NÃO se publica na Queue C.
 */
export function resolveCatalogTarget(
  marketplace: string,
  resolvedUrl: string,
): CatalogTarget | null {
  switch (marketplace) {
    case 'shopee': {
      const itemId = extractShopeeItemIdFromUrl(resolvedUrl);
      if (itemId === null) return null;
      return { marketplace, itemId: String(itemId), productKey: `shopee:${itemId}` };
    }
    case 'mercadolivre': {
      const itemId = extractMlItemIdFromUrl(resolvedUrl);
      if (!itemId) return null;
      return { marketplace, itemId, productKey: `mercadolivre:${itemId}` };
    }
    case 'amazon': {
      const itemId = extractAmazonAsinFromUrl(resolvedUrl);
      if (!itemId) return null;
      return { marketplace, itemId, productKey: `amazon:${itemId}` };
    }
    default:
      // magalu/unknown/outros: sem parser de itemId — não publica
      return null;
  }
}
