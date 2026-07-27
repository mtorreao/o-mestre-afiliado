/**
 * Shopee Affiliate Link Converter
 *
 * Endpoint: https://open-api.affiliate.shopee.com.br/graphql
 * Credenciais via env vars: SHOPEE_APP_ID, SHOPEE_SECRET
 *
 * A lógica PURA (assinatura SHA-256, extração de itemId/slug, normalização
 * de keyword, montagem de queries GraphQL, parsing de respostas) vive em
 * `shopee-pure.ts`. Este arquivo mantém SOMENTE a camada de I/O (fetch) e
 * os pontos de entrada públicos — nenhum header de auth ou lógica de fetch
 * foi alterado.
 */

import type { ConversionResult } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';
import {
  buildGenerateShortLinkMutation,
  buildProductOfferV2ByIdMutation,
  buildProductOfferV2ByKeywordMutation,
  buildShopeeAuthHeaders,
  extractFirstProductOffer,
  extractShopeeItemIdFromUrl as pureExtractShopeeItemIdFromUrl,
  extractShopeeShopIdFromUrl,
  extractShopeeSlug as pureExtractShopeeSlug,
  normalizeShopeeKeyword,
  parseGenerateShortLinkPayload,
  type ProductOfferV2Response,
  type ShopeeCredentials,
  type ShopeeProductOffer,
} from './shopee-pure.ts';

const API_URL = 'https://open-api.affiliate.shopee.com.br/graphql';

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
  return buildShopeeAuthHeaders(appId, secret, body, timestamp);
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

  try {
    const res = await fetch('https://open-api.affiliate.shopee.com.br/graphql', {
      method: 'POST',
      headers: buildShopeeAuthHeaders(appId, secret, body, timestamp),
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
 * Gera um link curto de afiliado Shopee via GraphQL API
 */
export async function generateShortLink(originUrl: string): Promise<string | null> {
  const { appId, secret } = getCredentials();

  const body = buildGenerateShortLinkMutation(originUrl);

  const headers = generateAuthHeaders(appId, secret, body);

  const res = await fetch(API_URL, {
    method: 'POST',
    headers,
    body,
  });

  const data = (await res.json()) as Record<string, unknown>;

  const { shortLink, errors } = parseGenerateShortLinkPayload(data);

  if (shortLink) {
    return shortLink;
  }

  // Erro da API
  if (errors?.length) {
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
    const body = buildGenerateShortLinkMutation(url);

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: generateAuthHeaders(appId, secret, body),
      body,
    });

    const data = (await res.json()) as Record<string, unknown>;
    const { shortLink, errors } = parseGenerateShortLinkPayload(data);

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
    if (errors?.length) {
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

export type { ShopeeCredentials, ShopeeProductOffer, ProductOfferV2Response };

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
  const itemId = pureExtractShopeeItemIdFromUrl(originUrl);
  const shopId = extractShopeeShopIdFromUrl(originUrl);

  // ── Estratégia 1: productOfferV2 com itemId+shopId ─
  if (itemId && shopId) {
    const offer = await queryProductOfferV2(credentials, itemId, shopId);
    if (offer) return offer;
  }

  // ── Estratégia 2: productOfferV2 com keyword (slug) ─
  const slug = pureExtractShopeeSlug(originUrl);
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
  const body = buildProductOfferV2ByIdMutation(itemId, shopId);

  const response = await shopeeGraphqlRequest(credentials, body);
  return extractFirstProductOffer(response as ProductOfferV2Response | null);
}

/**
 * Faz a query GraphQL productOfferV2 com keyword (slug).
 * Útil quando a URL tem o slug mas itemId/shopId não parseiam.
 */
async function queryProductOfferV2ByKeyword(
  credentials: ShopeeCredentials,
  keyword: string,
): Promise<ShopeeProductOffer | null> {
  const cleanKeyword = normalizeShopeeKeyword(keyword);

  const body = buildProductOfferV2ByKeywordMutation(cleanKeyword);

  const response = await shopeeGraphqlRequest(credentials, body);
  return extractFirstProductOffer(response as ProductOfferV2Response | null);
}

/** Exportado apenas para teste unitário. */
export const _testExtractShopeeItemIdFromUrl = pureExtractShopeeItemIdFromUrl;
/** Exportado apenas para teste unitário. */
export const _testExtractShopeeSlug = pureExtractShopeeSlug;
/** Exportado apenas para teste unitário (lógica pura de assinatura SHA-256). */
export const _testGenerateAuthHeaders = generateAuthHeaders;

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
