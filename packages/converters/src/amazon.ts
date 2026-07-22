/**
 * Amazon Affiliate Link Converter
 *
 * A Amazon Associates não possui uma API pública simples para gerar links
 * de afiliado (apenas o Product Advertising API 5.0, que requer setup complexo).
 *
 * Estratégia: extrair o ASIN da URL do produto e adicionar o tracking ID
 * como parâmetro `tag` na URL.
 *
 * Formato: https://www.amazon.com.br/dp/{ASIN}/?tag={trackingId}
 */

import type { ConversionResult } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';

// ─── Regex ────────────────────────────────────────────────────────────

/** Extrai ASIN de URLs da Amazon */
const AMAZON_ASIN_REGEX =
  /(?:amazon(?:\.com?\.)?\w+\.[a-z]{2,3}\/)?(?:dp|gp\/product|gp\/offer-listing|exec\/obidos\/asin)\/([A-Z0-9]{10})(?:\/|$|\?)/i;

/** Detecta link curto amzn.to */
const AMZN_TO_REGEX = /amzn\.to\/([A-Za-z0-9]+)/i;

/** Detecta link de redirect go.promozone.ai/amazon */
const PROMOZONE_AMAZON_REGEX = /go\.promozone\.ai\/amazon/i;

/** Extrai ASIN de URL go.promozone.ai/amazon/<ASIN> */
const PROMOZONE_ASIN_REGEX = /go\.promozone\.ai\/amazon\/([A-Z0-9]{10})/i;

// ─── Funções principais ───────────────────────────────────────────────

/**
 * Extrai o ASIN de uma URL da Amazon.
 * Retorna null se não for possível extrair.
 */
export function extractAsin(url: string): string | null {
  const match = url.match(AMAZON_ASIN_REGEX);
  if (match?.[1]) return match[1].toUpperCase();

  // Tenta extrair de URL padrão com /ref= que não tem /dp/ explícito
  // Ex: https://www.amazon.com.br/Product-Name/dp/B0XXXXXXX
  const dpMatch = url.match(/\/dp\/([A-Z0-9]{10})/i);
  if (dpMatch?.[1]) return dpMatch[1].toUpperCase();

  return null;
}

/**
 * Verifica se é uma URL curta amzn.to que precisa ser resolvida.
 */
export function isShortUrl(url: string): boolean {
  return AMZN_TO_REGEX.test(url);
}

/**
 * Verifica se é um link promozone de Amazon.
 */
export function isPromozoneAmazonUrl(url: string): boolean {
  return PROMOZONE_AMAZON_REGEX.test(url);
}

/**
 * Tenta extrair ASIN diretamente de URL go.promozone.ai/amazon/<ASIN>.
 */
export function extractPromozoneAsin(url: string): string | null {
  const match = url.match(PROMOZONE_ASIN_REGEX);
  return match?.[1]?.toUpperCase() ?? null;
}

/**
 * Tenta resolver URL go.promozone.ai/amazon seguindo redirect HTTP.
 * Se falhar (JS redirect), tenta extrair ASIN do path.
 */
export async function resolvePromozoneUrl(promozoneUrl: string): Promise<string | null> {
  try {
    // Tenta seguir redirect HTTP primeiro
    const res = await fetch(promozoneUrl, { method: 'HEAD', redirect: 'manual' });
    const location = res.headers.get('location');
    if (location && !location.includes('go.promozone.ai')) {
      return location;
    }

    // Se não houve redirect, tenta GET
    if (res.status === 200) {
      const res2 = await fetch(promozoneUrl);
      return res2.url;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve um link curto amzn.to para a URL completa.
 * Segue redirects HTTP.
 */
export async function resolveShortUrl(shortUrl: string): Promise<string | null> {
  try {
    const res = await fetch(shortUrl, { method: 'HEAD', redirect: 'manual' });

    // 301/302 → pega o location
    const location = res.headers.get('location');
    if (location && !location.includes('amzn.to')) {
      return location;
    }

    // Se não teve redirect, tenta GET
    if (res.status === 200) {
      const res2 = await fetch(shortUrl);
      return res2.url;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Constrói URL de afiliado Amazon com tracking ID.
 *
 * @param productUrl - URL completa do produto na Amazon (já resolvida, se era amzn.to)
 * @param trackingId - Código de afiliado (ex: "meuafiliado-20")
 * @returns URL de afiliado, ou null se não foi possível extrair o ASIN
 */
export function buildAffiliateUrl(productUrl: string, trackingId: string): string | null {
  const asin = extractAsin(productUrl);
  if (!asin) {
    // Fallback: adiciona o tag na URL mesmo sem ASIN conhecido
    try {
      const url = new URL(productUrl);
      url.searchParams.set('tag', trackingId);
      return url.toString();
    } catch {
      return null;
    }
  }

  // Constrói URL limpa com o ASIN + tag
  return `https://www.amazon.com.br/dp/${asin}/?tag=${encodeURIComponent(trackingId)}`;
}

// ─── Função de conversão principal ────────────────────────────────────

/**
 * Converte uma URL da Amazon em link de afiliado usando credenciais
 * passadas explicitamente.
 *
 * Estratégia:
 * 1. Se é amzn.to → resolve para URL completa
 * 2. Extrai ASIN
 * 3. Constrói URL com ?tag={trackingId}
 */
export async function convertAmazonUrlWithTrackingId(
  url: string,
  trackingId: string | null | undefined,
): Promise<ConversionResult> {
  try {
    const marketplace = detectMarketplace(url);
    if (marketplace !== 'amazon') {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace,
        method: 'unknown',
        error: 'URL não é da Amazon',
      };
    }

    if (!trackingId) {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace: 'amazon',
        method: 'unknown',
        error: 'Amazon tracking ID não configurado',
      };
    }

    // 1. Resolver link curto amzn.to ou promozone
    let targetUrl = url;
    if (isShortUrl(url)) {
      const resolved = await resolveShortUrl(url);
      if (resolved) {
        targetUrl = resolved;
      }
    } else if (isPromozoneAmazonUrl(url)) {
      // Primeiro tenta extrair ASIN diretamente do path
      const promozoneAsin = extractPromozoneAsin(url);
      if (promozoneAsin) {
        // Já temos o ASIN — constrói URL limpa direto
        return {
          success: true,
          originalUrl: url,
          affiliateUrl: `https://www.amazon.com.br/dp/${promozoneAsin}/?tag=${encodeURIComponent(trackingId)}`,
          marketplace: 'amazon',
          method: 'promozone',
        };
      }
      // Tenta seguir o redirect HTTP
      const resolved = await resolvePromozoneUrl(url);
      if (resolved) {
        targetUrl = resolved;
      }
    }

    // 2. Construir URL de afiliado
    const affiliateUrl = buildAffiliateUrl(targetUrl, trackingId);

    if (!affiliateUrl) {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace: 'amazon',
        method: 'unknown',
        error: 'Não foi possível extrair o ASIN da URL da Amazon',
      };
    }

    return {
      success: true,
      originalUrl: url,
      affiliateUrl,
      marketplace: 'amazon',
      method: 'fallback', // Amazon usa parâmetro na URL (?tag=)
    };
  } catch (error) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'amazon',
      method: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Converte uma URL da Amazon em link de afiliado
 * (usa tracking ID do .env: AMAZON_TRACKING_ID).
 */
export async function convertAmazonUrl(url: string): Promise<ConversionResult> {
  const trackingId = process.env.AMAZON_TRACKING_ID;
  return convertAmazonUrlWithTrackingId(url, trackingId ?? null);
}
