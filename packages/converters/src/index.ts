/**
 * @omestre/converters - Conversores de links de afiliados
 */

export {
  generateShortLink,
  convertShopeeUrl,
} from './shopee.ts';
export type { ShopeeCredentials } from './shopee.ts';

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

/**
 * Converte qualquer URL suportada em link de afiliado.
 * Detecta automaticamente o marketplace.
 */
import { detectMarketplace } from '@omestre/shared';
import type { ConversionResult } from '@omestre/shared';
import { convertShopeeUrl } from './shopee.ts';
import { convertMercadoLivreUrl } from './mercadolivre.ts';

export async function convertUrl(url: string): Promise<ConversionResult> {
  const marketplace = detectMarketplace(url);

  switch (marketplace) {
    case 'shopee':
      return convertShopeeUrl(url);
    case 'mercadolivre':
      return convertMercadoLivreUrl(url);
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
