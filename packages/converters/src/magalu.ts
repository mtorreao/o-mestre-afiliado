/**
 * Magalu Affiliate Link Converter
 *
 * O programa Influenciador Magalu (Magazine Você) NÃO possui API pública
 * para gerar links de afiliado. O método padrão é construir a URL do tipo:
 *
 *   https://www.magazinevoce.com.br/{storeSlug}/{slugProduto}/p/{productId}/{cat}/{subCat}/
 *
 * O `storeSlug` é o nome da loja do afiliado no Magazine Você (escolhido no
 * cadastro). Exemplos reais observados:
 *   https://www.magazinevoce.com.br/magazinemoniquespg/eliptico-.../p/eadk91754h/es/elet/
 *
 * Shortlinks que precisam ser resolvidos via HTTP (HEAD/GET) antes da conversão:
 *   - maga.lu/<id>                  — shortlink oficial Magalu
 *   - go.promozone.ai/magalu/<id>    — shortlink do agregador Promozone
 *
 * OneLink (link curto de afiliado) é gerado via API interna do Magalu:
 *   POST https://www.magazinevoce.com.br/azion-rochelle-proxy/v1/shortenlink/onelink
 *   { "addPartnerId": true, "desktopLink": "...", "link": "..." }
 *   → { "shortenedLink": "https://magazineluiza.onelink.me/{mediaSource}/{clickId}" }
 *
 * Esta camada depende do módulo puro `magalu-pure.ts` (sem rede) para toda a
 * lógica de detecção/extração/construção.
 */

import type { ConversionResult } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';
import {
  buildMagaluAffiliateLinkPureSafe,
  extractMagaluProductIdPure,
  extractMagaluShortlinkIdPure,
  extractPromozoneMagaluIdPure,
  isMagaluOnelinkUrlPure,
  isMagaluShortlinkPure,
  isPromozoneMagaluUrlPure,
  validateMagaluStoreSlugPure,
} from './magalu-pure.ts';

// ─── Constantes ─────────────────────────────────────────────────────

const ONELINK_API_URL =
  'https://www.magazinevoce.com.br/azion-rochelle-proxy/v1/shortenlink/onelink';

// ─── Resolução de shortlinks (I/O) ──────────────────────────────────

/**
 * Resolve um shortlink `maga.lu/<id>` para a URL real do Magazine Você /
 * Magazine Luiza. Segue redirects HTTP (HEAD + GET fallback).
 *
 * Retorna `null` se a URL não for um shortlink Magalu ou se a resolução falhar
 * (timeout, 404, sem Location header).
 */
export async function resolveMagaluShortlink(shortUrl: string): Promise<string | null> {
  if (!isMagaluShortlinkPure(shortUrl)) return null;
  const id = extractMagaluShortlinkIdPure(shortUrl);
  if (!id) return null;

  try {
    const headRes = await fetch(shortUrl, { method: 'HEAD', redirect: 'manual' });
    if ([301, 302, 303, 307, 308].includes(headRes.status)) {
      const location = headRes.headers.get('location');
      if (location && !location.includes('maga.lu')) {
        return location;
      }
    }
    if (headRes.status === 200) {
      const getRes = await fetch(shortUrl, { redirect: 'follow' });
      if (getRes.url && !getRes.url.includes('maga.lu')) {
        return getRes.url;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve um shortlink `go.promozone.ai/magalu/<id>` para a URL real do produto
 * Magalu. Segue redirect HTTP; se retornar HTML estático (JS-redirect), retorna null.
 *
 * Retorna `null` se a URL não for Promozone de Magalu ou se a resolução falhar.
 */
export async function resolvePromozoneMagaluUrl(promozoneUrl: string): Promise<string | null> {
  if (!isPromozoneMagaluUrlPure(promozoneUrl)) return null;
  const id = extractPromozoneMagaluIdPure(promozoneUrl);
  if (!id) return null;

  try {
    const headRes = await fetch(promozoneUrl, { method: 'HEAD', redirect: 'manual' });
    const location = headRes.headers.get('location');
    if (location && !location.includes('go.promozone.ai')) {
      return location;
    }
    if (headRes.status === 200) {
      const getRes = await fetch(promozoneUrl, { redirect: 'follow' });
      if (getRes.url && !getRes.url.includes('go.promozone.ai')) {
        return getRes.url;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Geração de OneLink (afiliado, análogo ao ML Link Builder) ──────

/**
 * Gera um OneLink de afiliado Magalu via API interna (Azion Edge proxy).
 *
 * Requer cookies de sessão do magazinevoce.com.br (login ativo). A API é
 * servida via Azion Edge, que autentica via cookie de sessão automaticamente.
 *
 * Análogo ao `generateShortAffiliateLink` do Mercado Livre, que também
 * requer cookies de sessão e chama uma API interna.
 *
 * @param sessionCookies  Cookie string da sessão do magazinevoce.com.br
 * @param desktopLink     URL do produto na magazineluiza.com.br (desktop)
 * @returns               OneLink URL ou null se falhar (cookie expirado, API offline, etc.)
 */
export async function generateMagaluOneLink(
  sessionCookies: string,
  desktopLink: string,
): Promise<string | null> {
  // Constrói a URL mobile a partir da desktop
  let link: string;
  try {
    link = desktopLink.replace('www.magazineluiza.com.br', 'm.magazineluiza.com.br');
  } catch {
    return null;
  }

  try {
    const res = await fetch(ONELINK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookies,
        Origin: 'https://www.magazinevoce.com.br',
        Referer: 'https://www.magazinevoce.com.br/',
      },
      body: JSON.stringify({
        addPartnerId: true,
        desktopLink,
        link,
      }),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { shortenedLink?: string };
    return data.shortenedLink ?? null;
  } catch {
    return null;
  }
}

/**
 * Normaliza uma URL de produto para o formato desktop magazineluiza.com.br.
 * Se já for desktop, retorna como está. Se for mobile (m.*), troca o domínio.
 */
function normalizeToDesktopUrl(url: string): string | null {
  try {
    if (/^https?:\/\/(?:www\.)?magazineluiza\.com\.br/i.test(url)) {
      return url;
    }
    if (/^https?:\/\/m\.magazineluiza\.com\.br/i.test(url)) {
      return url.replace(/^https?:\/\/m\./i, 'https://www.');
    }
    // Se for magazinevoce.com.br, usa a path para construir URL magazineluiza
    const mvMatch = url.match(/^https?:\/\/(?:www\.)?magazinevoce\.com\.br\/[a-z0-9-]+\/(.+)$/i);
    if (mvMatch?.[1]) {
      const productId = extractMagaluProductIdPure(url);
      if (productId) {
        return `https://www.magazineluiza.com.br/${mvMatch[1]}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Função de conversão principal ───────────────────────────────────

/**
 * Converte uma URL Magalu em link de afiliado.
 *
 * Fluxo:
 *   0. Se a URL já é um OneLink → retorna como está (já é link afiliado).
 *   1. Detecta marketplace — só processa `magalu`. Retorna erro caso contrário.
 *   2. Valida storeSlug (3-40 chars, [a-z0-9-], sem hífen nas pontas).
 *   3. Resolve shortlinks (`maga.lu/...`, `go.promozone.ai/magalu/...`) → URL real.
 *   4. Constrói `magazinevoce.com.br/{slug}/...` (fallback determinístico, sem cookies).
 *
 * Para gerar OneLink (que requer cookies de sessão), chame
 * `generateMagaluOneLink(sessionCookies, desktopLink)` separadamente, após
 * obter a URL normalizada por esta função.
 *
 * @param url             URL original (qualquer formato Magalu conhecido)
 * @param storeSlug       Slug do afiliado no Magazine Você
 */
export async function convertMagaluUrlWithStoreSlug(
  url: string,
  storeSlug: string | null | undefined,
): Promise<ConversionResult> {
  try {
    // 0. Se já é OneLink, retorna como está (já é link afiliado)
    if (isMagaluOnelinkUrlPure(url)) {
      return {
        success: true,
        originalUrl: url,
        affiliateUrl: url,
        marketplace: 'magalu',
        method: 'api',
      };
    }

    const marketplace = detectMarketplace(url);
    if (marketplace !== 'magalu') {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace,
        method: 'unknown',
        error: 'URL não é da Magalu',
      };
    }

    // 1. Valida storeSlug primeiro (fail fast)
    const slugValidation = validateMagaluStoreSlugPure(storeSlug);
    if (!slugValidation.valid) {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace: 'magalu',
        method: 'unknown',
        error: `Afiliado Magalu sem slug configurado: ${slugValidation.reason ?? 'inválido'}`,
      };
    }

    // 2. Resolve shortlink se necessário
    let targetUrl = url;
    let resolvedVia: 'shortlink' | 'promozone' | null = null;
    if (isMagaluShortlinkPure(url)) {
      const resolved = await resolveMagaluShortlink(url);
      if (resolved) {
        targetUrl = resolved;
        resolvedVia = 'shortlink';
      } else {
        return {
          success: false,
          originalUrl: url,
          affiliateUrl: null,
          marketplace: 'magalu',
          method: 'unknown',
          error: `Não foi possível resolver shortlink maga.lu: ${url}`,
        };
      }
    } else if (isPromozoneMagaluUrlPure(url)) {
      const resolved = await resolvePromozoneMagaluUrl(url);
      if (resolved) {
        targetUrl = resolved;
        resolvedVia = 'promozone';
      } else {
        return {
          success: false,
          originalUrl: url,
          affiliateUrl: null,
          marketplace: 'magalu',
          method: 'unknown',
          error: `Não foi possível resolver shortlink go.promozone.ai/magalu: ${url}`,
        };
      }
    }

    // 3. Garante que a URL (resolvida ou original) é de produto Magalu
    if (!extractMagaluProductIdPure(targetUrl)) {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace: 'magalu',
        method: 'unknown',
        error: `URL não contém ID de produto Magalu identificável: ${targetUrl}`,
      };
    }

    // 4. Constrói magazinevoce.com.br/{slug}/... (fallback determinístico)
    const affiliateUrl = buildMagaluAffiliateLinkPureSafe({
      productUrl: targetUrl,
      storeSlug: storeSlug!,
    });

    if (!affiliateUrl) {
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace: 'magalu',
        method: 'unknown',
        error: 'Falha ao construir URL de afiliado Magalu',
      };
    }

    const method: ConversionResult['method'] =
      resolvedVia === 'shortlink' ? 'api' : resolvedVia === 'promozone' ? 'promozone' : 'fallback';

    return {
      success: true,
      originalUrl: url,
      affiliateUrl,
      marketplace: 'magalu',
      method,
    };
  } catch (error) {
    return {
      success: false,
      originalUrl: url,
      affiliateUrl: null,
      marketplace: 'magalu',
      method: 'unknown',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Converte uma URL Magalu usando o storeSlug do `.env` (MAGALU_STORE_NAME).
 *
 * ⚠️ Para fluxo MULTI-AFILIADO (painel), prefira
 * `convertMagaluUrlWithStoreSlug` passando o slug do afiliado.
 * Esta função é mantida para o CLI (`bun run magalu <url>`) e o
 * fallback global em `/api/convert`.
 */
export async function convertMagaluUrl(url: string): Promise<ConversionResult> {
  const storeSlug = process.env.MAGALU_STORE_NAME;
  return convertMagaluUrlWithStoreSlug(url, storeSlug ?? null);
}
