import { describe, expect, test } from 'bun:test';
import {
  extractSocialProductDataFromHtml,
  type SocialProductResolution,
} from './resolve-social-product.ts';
import { extractOgImageFromHtml } from './product-image.ts';

describe('Mercado Livre image extraction', () => {
  test('reuses product URL and og:image from the same /social/ HTML response', () => {
    const html = `
      <html><head>
        <meta property="og:image" content="https://http2.mlstatic.com/social-product.webp">
      </head><body>
        <a href="https://www.mercadolivre.com.br/produto/p/MLB12345678?tracking=other">
          Ir para o Produto
        </a>
      </body></html>
    `;

    expect(extractSocialProductDataFromHtml(html)).toEqual<SocialProductResolution>({
      productUrl: 'https://www.mercadolivre.com.br/produto/p/MLB12345678',
      imageUrl: 'https://http2.mlstatic.com/social-product.webp',
    });
  });

  test('extracts og:image regardless of meta attribute order', () => {
    const html = `
      <meta content='https://http2.mlstatic.com/product.webp' property='og:image'>
    `;

    expect(extractOgImageFromHtml(html, 'https://www.mercadolivre.com.br/p/MLB12345678')).toBe(
      'https://http2.mlstatic.com/product.webp',
    );
  });
});
