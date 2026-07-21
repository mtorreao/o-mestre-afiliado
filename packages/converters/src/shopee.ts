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
