import { detectMarketplace } from '@omestre/shared';
import { convertMercadoLivreUrl, convertShopeeUrl, convertAmazonUrl } from '@omestre/converters';
import type { ConversionResult } from '@omestre/shared';

export async function convertMarketplaceUrl(
  url: string,
  marketplace?: string,
): Promise<{ success: boolean; convertedUrl?: string; error?: string }> {
  const detected = marketplace || detectMarketplace(url);
  let result: ConversionResult | null = null;

  try {
    switch (detected) {
      case 'mercadolivre':
        result = await convertMercadoLivreUrl(url);
        break;
      case 'shopee':
        result = await convertShopeeUrl(url);
        break;
      case 'amazon':
        result = await convertAmazonUrl(url);
        break;
      default: {
        const auto = detectMarketplace(url);
        if (auto !== 'unknown') return convertMarketplaceUrl(url, auto);
        return { success: false, error: `Marketplace não suportado: ${detected}` };
      }
    }
  } catch {
    return { success: false, error: `Falha ao converter link` };
  }

  if (!result) return { success: false, error: 'Falha na conversão' };

  return {
    success: result.success,
    convertedUrl: result.affiliateUrl || undefined,
    error: result.error,
  };
}
