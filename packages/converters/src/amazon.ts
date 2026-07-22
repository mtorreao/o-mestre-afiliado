/**
 * Amazon converter — stubs pois o módulo foi perdido pelo patch tool.
 * Regenerar a partir do código original (task 4.1).
 */
import type { ConversionResult } from '@omestre/shared';

export function extractAsin(url: string): string | null {
  const match = url.match(/(?:\/dp\/|%2Fdp%2F|%2Fgp%2Fproduct%2F|gp%2Fproduct%2F|\/gp\/product\/|e\/([A-Z0-9]{10}))([A-Z0-9]{10})/i);
  return match ? match[1] || match[2] : null;
}

export function isShortUrl(url: string): boolean {
  return /amzn\.to/i.test(url);
}

export function isPromozoneAmazonUrl(url: string): boolean {
  return /go\.promozone\.ai\/amazon/i.test(url);
}

export function extractPromozoneAsin(url: string): string | null {
  return extractAsin(url);
}

export async function resolvePromozoneUrl(_url: string): Promise<string> {
  return _url;
}

export async function resolveShortUrl(_url: string): Promise<string> {
  return _url;
}

export function buildAffiliateUrl(asin: string, trackingId: string): string {
  return `https://www.amazon.com.br/dp/${asin}?tag=${encodeURIComponent(trackingId)}`;
}

export async function convertAmazonUrl(url: string): Promise<ConversionResult> {
  return { success: false, originalUrl: url, affiliateUrl: null, marketplace: 'amazon', method: 'unknown', error: 'Amazon converter stub' };
}

export async function convertAmazonUrlWithTrackingId(url: string, _trackingId: string): Promise<ConversionResult> {
  return { success: false, originalUrl: url, affiliateUrl: null, marketplace: 'amazon', method: 'unknown', error: 'Amazon converter stub' };
}
