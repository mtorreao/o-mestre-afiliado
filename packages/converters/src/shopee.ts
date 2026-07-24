/**
 * Shopee Affiliate Link Converter
 *
 * Endpoint: https://open-api.affiliate.shopee.com.br/graphql
 * Credenciais via env vars: SHOPEE_APP_ID, SHOPEE_SECRET
 */

import { createHash } from 'node:crypto';
import type { ConversionResult } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';

const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

export interface ShopeeCredentials {
  appId: string;
  secret: string;
}

function getCredentials(): ShopeeCredentials {
  const appId = process.env.SHOPEE_APP_ID;
  const secret = process.env.SHOPEE_SECRET;

  if (!appId || !secret) {
    throw new Error(
      'Credenciais Shopee não encontradas. Defina SHOPEE_APP_ID e SHOPEE_SECRET no .env',
    );
  }

  return { appId, secret };
}

function generateAuthHeaders(appId: string, secret: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${appId}${timestamp}${body}${secret}`;
  const signature = createHash('sha256').update(payload).digest('hex');

  return {
    'Content-Type': 'application/json',
    Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
  };
}

/**
 * Gera um link curto de afiliado Shopee via GraphQL API
 */
export async function generateShortLink(originUrl: string): Promise<string | null> {
  const { appId, secret } = getCredentials();

  const body = JSON.stringify({
    query: `mutation {
      generateShortLink(input: { originUrl: "${originUrl}" }) {
        shortLink
      }
    }`,
  });

  const headers = generateAuthHeaders(appId, secret, body);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body,
  });

  const data = await res.json() as Record<string, unknown>;

  const dataNode = data?.data as Record<string, unknown> | undefined;
  const generateNode = dataNode?.generateShortLink as Record<string, unknown> | undefined;
  const shortLink = generateNode?.shortLink as string | undefined;

  if (shortLink) {
    return shortLink;
  }

  // Erro da API
  if (data?.errors) {
    const errors = data.errors as Array<{ message: string; extensions?: { code?: string } }>;
    const err = errors[0];
    if (err) {
      throw new Error(`Shopee API error ${err.extensions?.code ?? ''}: ${err.message}`);
    }
  }

  return null;
}

/**
 * Converte uma URL de produto Shopee em link de afiliado
 * usando credenciais passadas explicitamente.
 */
export async function convertShopeeUrlWithCredentials(
  url: string,
  credentials: ShopeeCredentials,
): Promise<ConversionResult> {
  try {
    const marketplace = detectMarketplace(url);

    if (marketplace !== 'shopee') {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace,
        method: 'unknown',
        error: 'URL não é da Shopee',
      };
    }

    const { appId, secret } = credentials;
    const body = JSON.stringify({
      query: `mutation {
      generateShortLink(input: { originUrl: "${url}" }) {
        shortLink
      }
    }`,
    });

    const headers = generateAuthHeaders(appId, secret, body);

    const res = await fetch(API_URL, {
      method: 'POST',
      headers,
      body,
    });

    const data = await res.json() as Record<string, unknown>;
    const dataNode = data?.data as Record<string, unknown> | undefined;
    const generateNode = dataNode?.generateShortLink as Record<string, unknown> | undefined;
    const shortLink = generateNode?.shortLink as string | undefined;

    if (shortLink) {
      return {
        success: true,
        originalUrl: url,
        affiliateUrl: shortLink,
        marketplace: 'shopee',
        method: 'api',
      };
    }

    // Erro da API
    if (data?.errors) {
      const errors = data.errors as Array<{ message: string }>;
      const err = errors[0];
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace: 'shopee',
        method: 'api',
        error: err?.message || 'Erro na API Shopee',
      };
    }

    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'shopee',
      method: 'api',
      error: 'Falha ao gerar link de afiliado',
    };
  } catch (error) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'shopee',
      method: 'api',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Interface de retorno da query productOfferV2 (Shopee Affiliate GraphQL).
 * Retorna metadados de uma oferta de produto, incluindo imageUrl.
 */
export interface ShopeeProductOffer {
  itemId: number;
  shopId: number;
  productName?: string;
  imageUrl?: string;
  offerLink?: string;
  price?: number;
  priceMin?: number;
  priceMax?: number;
  commissionRate?: string;
}

/**
 * Busca metadados de uma oferta de produto Shopee via GraphQL Affiliate API.
 *
 * Endpoint: https://open-api.affiliate.shopee.com.br/graphql
 * Query:    productOfferV2
 *
 * Estratégia:
 *   1. Tenta `productOfferV2` com itemId + shopId (mais preciso)
 *   2. Se não encontrar, tenta com `?keyword=slug` (mais lento, fallback)
 *
 * Retorna null se as credenciais não estiverem configuradas, se a API
 * retornar erro, ou se não houver oferta ativa para o produto.
 */
export async function getProductOffer(
  originUrl: string,
  credentials: ShopeeCredentials,
): Promise<ShopeeProductOffer | null> {
  const itemId = extractShopeeItemIdFromUrl(originUrl);
  const shopIdMatch = originUrl.match(/-i\.(\d+)\.(\d+)/i);
  const shopId = shopIdMatch ? parseInt(shopIdMatch[1]!, 10) : null;

  // ── Estratégia 1: productOfferV2 com itemId+shopId ─
  if (itemId && shopId) {
    const offer = await queryProductOfferV2(credentials, itemId, shopId);
    if (offer) return offer;
  }

  // ── Estratégia 2: productOfferV2 com keyword (slug) ─
  const slug = extractShopeeSlug(originUrl);
  if (slug) {
    const offer = await queryProductOfferV2ByKeyword(credentials, slug);
    if (offer) return offer;
  }

  return null;
}

/**
 * Faz a query GraphQL productOfferV2 com itemId+shopId.
 * Documentação: https://affiliate.shopee.com.br/docs/tnc/affiliate_solution/standard_package
 */
async function queryProductOfferV2(
  credentials: ShopeeCredentials,
  itemId: number,
  shopId: number,
): Promise<ShopeeProductOffer | null> {
  const body = JSON.stringify({
    query: `query {
      productOfferV2(itemId: ${itemId}, shopId: ${shopId}) {
        nodes {
          itemId
          shopId
          productName
          imageUrl
          offerLink
          price
          priceMin
          priceMax
          commissionRate
        }
      }
    }`,
  });

  const response = await shopeeGraphqlRequest(credentials, body);
  if (!response) return null;

  const data = response as {
    data?: {
      productOfferV2?: {
        nodes?: Array<ShopeeProductOffer>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (data.errors?.length) {
    return null;
  }

  return data.data?.productOfferV2?.nodes?.[0] ?? null;
}

/**
 * Faz a query GraphQL productOfferV2 com keyword (slug).
 * Útil quando a URL tem o slug mas itemId/shopId não parseiam.
 */
async function queryProductOfferV2ByKeyword(
  credentials: ShopeeCredentials,
  keyword: string,
): Promise<ShopeeProductOffer | null> {
  // Limpa o slug: remove acentos, mantém só alfanumérico + espaços
  const cleanKeyword = keyword
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  const body = JSON.stringify({
    query: `query {
      productOfferV2(keyword: "${cleanKeyword.replace(/"/g, '\\"')}", limit: 5, sortType: 1) {
        nodes {
          itemId
          shopId
          productName
          imageUrl
          offerLink
          price
          priceMin
          priceMax
          commissionRate
        }
      }
    }`,
  });

  const response = await shopeeGraphqlRequest(credentials, body);
  if (!response) return null;

  const data = response as {
    data?: {
      productOfferV2?: {
        nodes?: Array<ShopeeProductOffer>;
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (data.errors?.length) {
    return null;
  }

  return data.data?.productOfferV2?.nodes?.[0] ?? null;
}

/**
 * Faz a chamada GraphQL com autenticação SHA-256.
 * Retorna null em caso de erro (network, auth, malformed).
 */
async function shopeeGraphqlRequest(
  credentials: ShopeeCredentials,
  body: string,
): Promise<Record<string, unknown> | null> {
  const { appId, secret } = credentials;
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${appId}${timestamp}${body}${secret}`;
  const signature = createHash('sha256').update(payload).digest('hex');

  try {
    const res = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return null;

    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Extrai o itemId (segundo número no padrão -i.SHOPID.ITEMID) de uma URL Shopee.
 */
function extractShopeeItemIdFromUrl(url: string): number | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[2]) return parseInt(m[2], 10);
  // Tenta formato /product/{shopid}/{itemid}
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[2]) return parseInt(productMatch[2], 10);
  return null;
}

/**
 * Extrai o slug do produto de uma URL Shopee.
 * Ex: shopee.com.br/Capinha-iPhone-i.123.456 → "Capinha-iPhone"
 */
function extractShopeeSlug(url: string): string | null {
  const m = url.match(/shopee\.com\.br\/([^/?#]+)-i\./i);
  if (m?.[1]) return m[1];
  // slug puro sem -i.
  const m2 = url.match(/shopee\.com\.br\/([^/?#]+)/i);
  if (m2?.[1] && !m2[1].startsWith('product')) return m2[1];
  return null;
}

/**
 * Converte uma URL de produto Shopee em link de afiliado
 * (usa credenciais do .env).
 */
export async function convertShopeeUrl(url: string): Promise<ConversionResult> {
  try {
    const marketplace = detectMarketplace(url);

    if (marketplace !== 'shopee') {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace,
        method: 'unknown',
        error: 'URL não é da Shopee',
      };
    }

    const affiliateUrl = await generateShortLink(url);

    return {
      success: !!affiliateUrl,
      originalUrl: url,
      affiliateUrl,
      marketplace: 'shopee',
      method: 'api',
      error: affiliateUrl ? undefined : 'Falha ao gerar link de afiliado',
    };
  } catch (error) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'shopee',
      method: 'api',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
