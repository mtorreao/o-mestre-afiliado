/**
 * @omestre/converters - Conversores de links de afiliados
 */

export {
  generateShortLink,
  convertShopeeUrl,
  convertShopeeUrlWithCredentials,
  getProductOffer,
} from './shopee.ts';
export type { ShopeeCredentials, ShopeeProductOffer } from './shopee.ts';

export { extractShopeeItemIdFromUrl } from './shopee-pure.ts';

export {
  getCredentials,
  getAccessToken,
  generateViaApi,
  generateViaCookies,
  generateViaUrlParams,
  refreshSessionCookies,
  isMercadoLivreUrl,
  convertMercadoLivreUrl,
  convertMercadoLivreUrlWithToken,
} from './mercadolivre.ts';
export type { MercadoLivreCredentials, MlConversionOptions, MlStrategy } from './mercadolivre.ts';

export { generateShortAffiliateLink } from './ml-linkbuilder.ts';
export type { ShortLinkResult } from './ml-linkbuilder-pure.ts';

export {
  extractAsin,
  isShortUrl,
  isPromozoneAmazonUrl,
  extractPromozoneAsin,
  resolvePromozoneUrl,
  resolveShortUrl,
  buildAffiliateUrl,
  convertAmazonUrl,
  convertAmazonUrlWithTrackingId,
  convertAmazonUrlWithAffiliate,
} from './amazon.ts';
export type { ConvertAmazonMultiOptions } from './amazon.ts';

export {
  resolveMagaluShortlink,
  resolvePromozoneMagaluUrl,
  generateMagaluOneLink,
  convertMagaluUrlWithStoreSlug,
  convertMagaluUrl,
} from './magalu.ts';

export {
  isMagaluShortlinkPure,
  isMagazineluizaProductUrlPure,
  isMagazinevoceProductUrlPure,
  isPromozoneMagaluUrlPure,
  isMagaluOnelinkUrlPure,
  isMagaluProductUrlPure,
  extractPromozoneMagaluIdPure,
  extractMagaluProductIdPure,
  extractMagazinevoceStoreSlugPure,
  extractMagaluShortlinkIdPure,
  validateMagaluStoreSlugPure,
  buildMagaluAffiliateLinkPure,
  buildMagaluAffiliateLinkPureSafe,
} from './magalu-pure.ts';
export type { BuildMagaluLinkInput, SlugValidation } from './magalu-pure.ts';

/**
 * Converte qualquer URL suportada em link de afiliado.
 * Detecta automaticamente o marketplace.
 */
import { detectMarketplace } from '@omestre/shared';
import type { ConversionResult } from '@omestre/shared';
import { convertShopeeUrl } from './shopee.ts';
import { convertMercadoLivreUrl } from './mercadolivre.ts';
import { convertAmazonUrl } from './amazon.ts';
import { convertMagaluUrl } from './magalu.ts';

export async function convertUrl(url: string): Promise<ConversionResult> {
  const marketplace = detectMarketplace(url);

  switch (marketplace) {
    case 'shopee':
      return convertShopeeUrl(url);
    case 'mercadolivre':
      return convertMercadoLivreUrl(url);
    case 'amazon':
      return convertAmazonUrl(url);
    default:
      return {
        success: false,
        originalUrl: url,
        affiliateUrl: null,
        marketplace,
        method: 'unknown',
        error: `Marketplace não suportado: ${marketplace}`,
      };
  }
}

/**
 * Seleciona a função de conversão adequada para o marketplace.
 * Retorna a função sem executá-la (útil para testes e lazy evaluation).
 */
export function selectConverter(
  marketplace: string,
): ((url: string) => Promise<ConversionResult>) | null {
  switch (marketplace) {
    case 'shopee':
      return convertShopeeUrl;
    case 'mercadolivre':
      return convertMercadoLivreUrl;
    case 'amazon':
      return convertAmazonUrl;
    case 'magalu':
      return convertMagaluUrl;
    default:
      return null;
  }
}
