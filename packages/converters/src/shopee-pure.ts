/**
 * Lógica PURA do conversor de Shopee.
 *
 * Separa a montagem do header de autenticação SHA-256, a extração de
 * itemId/slug de URLs, a normalização de keyword, a montagem das queries
 * GraphQL e o parsing de respostas da camada de I/O (fetch).
 * Todas as funções aqui são síncronas, não dependem de rede e são 100%
 * testáveis.
 *
 * O I/O (fetch GraphQL + assinatura com timestamp) fica em `shopee.ts`,
 * que consome este módulo. O prefixo 'SHA256' dos headers NÃO é alterado.
 */

import { createHash } from 'node:crypto';

export interface ShopeeCredentials {
  appId: string;
  secret: string;
}

// ─── Assinatura SHA-256 (header de auth) ───────────────────────────────

/**
 * Gera o payload assinado para o header Authorization da Shopee Affiliate API.
 * `timestamp` é injetável para tornar a função pura e testável (o caller
 * usa `Math.floor(Date.now() / 1000)`).
 *
 * IMPORTANTE: o prefixo deve continuar sendo 'SHA256' — não alterar.
 */
export function buildShopeeAuthSignature(
  appId: string,
  secret: string,
  body: string,
  timestamp: number,
): { payload: string; signature: string } {
  const payload = `${appId}${timestamp}${body}${secret}`;
  const signature = createHash('sha256').update(payload).digest('hex');
  return { payload, signature };
}

/** Objeto de headers de autenticação (Content-Type + Authorization). */
export interface ShopeeAuthHeaders extends Record<string, string> {
  'Content-Type': string;
  Authorization: string;
}

/** Monta o objeto de headers de autenticação (Content-Type + Authorization). */
export function buildShopeeAuthHeaders(
  appId: string,
  secret: string,
  body: string,
  timestamp: number,
): ShopeeAuthHeaders {
  const { signature } = buildShopeeAuthSignature(appId, secret, body, timestamp);
  return {
    'Content-Type': 'application/json',
    Authorization: `SHA256 Credential=${appId}, Timestamp=${timestamp}, Signature=${signature}`,
  };
}

// ─── Extração de itemId / slug ─────────────────────────────────────────

/** Extrai o itemId (segundo número no padrão -i.SHOPID.ITEMID) de uma URL. */
export function extractShopeeItemIdFromUrl(url: string): number | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[2]) return parseInt(m[2], 10);
  // Tenta formato /product/{shopid}/{itemid}
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[2]) return parseInt(productMatch[2], 10);
  return null;
}

/** Extrai o shopId (primeiro número no padrão -i.SHOPID.ITEMID) de uma URL. */
export function extractShopeeShopIdFromUrl(url: string): number | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[1]) return parseInt(m[1], 10);
  return null;
}

/** Extrai o slug do produto de uma URL Shopee (ex: "Capinha-iPhone"). */
export function extractShopeeSlug(url: string): string | null {
  const m = url.match(/shopee\.com\.br\/([^/?#]+)-i\./i);
  if (m?.[1]) return m[1];
  // slug puro sem -i.
  const m2 = url.match(/shopee\.com\.br\/([^/?#]+)/i);
  if (m2?.[1] && !m2[1].startsWith('product')) return m2[1];
  return null;
}

// ─── Normalização de keyword ───────────────────────────────────────────

/**
 * Limpa o slug para uso como keyword na query productOfferV2:
 * remove acentos, mantém só alfanumérico + espaços, limita a 100 chars.
 */
export function normalizeShopeeKeyword(keyword: string): string {
  return keyword.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

// ─── Parsing de resposta GraphQL ───────────────────────────────────────

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

/** Tipo da resposta crua da query productOfferV2. */
export interface ProductOfferV2Response {
  data?: {
    productOfferV2?: {
      nodes?: Array<ShopeeProductOffer>;
    };
  };
  errors?: Array<{ message: string }>;
}

/**
 * Extrai a primeira oferta de uma resposta productOfferV2.
 * Retorna null se houver errors, se nodes estiver vazio/ausente, ou se a
 * resposta for nula.
 */
export function extractFirstProductOffer(
  response: ProductOfferV2Response | null | undefined,
): ShopeeProductOffer | null {
  if (!response) return null;
  if (response.errors?.length) return null;
  return response.data?.productOfferV2?.nodes?.[0] ?? null;
}

// ─── Montagem de queries GraphQL (corpos de requisição) ──────────────────

/**
 * Monta o corpo (JSON) da mutation `generateShortLink`.
 * Função pura: só interpola a originUrl na string da query.
 */
export function buildGenerateShortLinkMutation(originUrl: string): string {
  return JSON.stringify({
    query: `mutation {
      generateShortLink(input: { originUrl: "${originUrl}" }) {
        shortLink
      }
    }`,
  });
}

/**
 * Extrai o `shortLink` (e eventuais `errors`) da resposta crua da mutation
 * generateShortLink. Retorna `shortLink` ausente e a lista de errors (se houver).
 * Função pura: só faz cast/leitura da resposta.
 */
export function parseGenerateShortLinkPayload(data: Record<string, unknown> | null | undefined): {
  shortLink?: string;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
} {
  const dataNode = data?.data as Record<string, unknown> | undefined;
  const generateNode = dataNode?.generateShortLink as Record<string, unknown> | undefined;
  const shortLink = generateNode?.shortLink as string | undefined;

  const errors = data?.errors as
    Array<{ message: string; extensions?: { code?: string } }> | undefined;

  return { shortLink, errors };
}

/**
 * Monta a query GraphQL `productOfferV2` por itemId + shopId.
 * Função pura: só interpola os ids na string da query.
 */
export function buildProductOfferV2ByIdMutation(itemId: number, shopId: number): string {
  return JSON.stringify({
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
}

/**
 * Monta a query GraphQL `productOfferV2` por keyword (slug).
 * `keyword` é sanitizada (escapa aspas duplas) antes da interpolação.
 * Função pura: só interpola a keyword na string da query.
 */
export function buildProductOfferV2ByKeywordMutation(
  keyword: string,
  limit = 5,
  sortType = 1,
): string {
  const safeKeyword = keyword.replace(/"/g, '\\"');
  return JSON.stringify({
    query: `query {
      productOfferV2(keyword: "${safeKeyword}", limit: ${limit}, sortType: ${sortType}) {
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
}
