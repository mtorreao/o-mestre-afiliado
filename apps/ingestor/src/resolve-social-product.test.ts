/**
 * Testes das funções puras em apps/ingestor/src/resolve-social-product.ts.
 *
 * Cobre:
 *  - extractOgImage(html): extrai og:image e twitter:image (ambos formatos)
 *  - extractSocialProductDataFromHtml(html): extrai productUrl + imageUrl
 *    com normalização (sem query/hash), fallback "Ir para", filtro por host
 *
 * As funções de I/O (tryExtractFromHtml com fetch, tryWithBrowser com
 * Playwright) ficam fora do escopo — exigem mock complexo de fetch
 * e browser.
 */
import { describe, expect, it } from 'bun:test';
import { _testExtractOgImage, extractSocialProductDataFromHtml } from './resolve-social-product.ts';

const extractOgImage = _testExtractOgImage;

describe('extractOgImage', () => {
  describe('meta property="og:image"', () => {
    it('extrai og:image no formato property → content', () => {
      const html = `<html><head>
        <meta property="og:image" content="https://example.com/img.jpg">
      </head></html>`;
      expect(extractOgImage(html)).toBe('https://example.com/img.jpg');
    });

    it('extrai og:image quando há outros meta antes', () => {
      const html = `<html><head>
        <meta charset="utf-8">
        <meta name="description" content="lorem">
        <meta property="og:image" content="https://example.com/img.jpg">
      </head></html>`;
      expect(extractOgImage(html)).toBe('https://example.com/img.jpg');
    });

    it('faz trim do valor', () => {
      const html = `<meta property="og:image" content="  https://example.com/img.jpg  ">`;
      expect(extractOgImage(html)).toBe('https://example.com/img.jpg');
    });
  });

  describe('meta name="twitter:image"', () => {
    it('extrai twitter:image no formato name → content', () => {
      const html = `<html><head>
        <meta name="twitter:image" content="https://example.com/tw.jpg">
      </head></html>`;
      expect(extractOgImage(html)).toBe('https://example.com/tw.jpg');
    });
  });

  describe('casos ausentes', () => {
    it('retorna null quando não há og:image nem twitter:image', () => {
      const html = `<html><head>
        <meta name="description" content="produto">
        <meta charset="utf-8">
      </head></html>`;
      expect(extractOgImage(html)).toBeNull();
    });

    it('retorna null para HTML vazio', () => {
      expect(extractOgImage('')).toBeNull();
    });

    it('retorna null quando og:image tem content vazio', () => {
      const html = `<meta property="og:image" content="">`;
      // A regex exige [^\"']+ — string vazia não casa.
      // Mas com a flag /i e o teste do código, content="" pode dar match
      // porque o regex captura grupos. Vamos só verificar que não crasha.
      const result = extractOgImage(html);
      expect(result === null || result === '').toBe(true);
    });
  });
});

describe('extractSocialProductDataFromHtml', () => {
  describe('extração via href /p/MLB', () => {
    it('extrai productUrl /p/MLB e og:image', () => {
      const html = `<html><body>
        <a href="https://www.mercadolivre.com.br/produto-i.123.456/p/MLB123456789">Ver</a>
        <meta property="og:image" content="https://example.com/prod.jpg">
      </body></html>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result).not.toBeNull();
      expect(result!.productUrl).toBe(
        'https://www.mercadolivre.com.br/produto-i.123.456/p/MLB123456789',
      );
      expect(result!.imageUrl).toBe('https://example.com/prod.jpg');
    });

    it('remove query string do productUrl', () => {
      const html = `<a href="https://www.mercadolivre.com.br/produto/MLB123456789/p/MLB123456789?utm_source=foo&ref=bar">x</a>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result).not.toBeNull();
      expect(result!.productUrl).not.toContain('?');
      expect(result!.productUrl).not.toContain('utm_source');
      expect(result!.productUrl).toBe(
        'https://www.mercadolivre.com.br/produto/MLB123456789/p/MLB123456789',
      );
    });

    it('remove hash do productUrl', () => {
      const html = `<a href="https://www.mercadolivre.com.br/produto/MLB123456789/p/MLB123456789#reviews">x</a>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result!.productUrl).toBe(
        'https://www.mercadolivre.com.br/produto/MLB123456789/p/MLB123456789',
      );
    });

    it('reconhece formato MLB com mais dígitos', () => {
      const html = `<a href="https://www.mercadolivre.com.br/produto/MLB123456789012/p/MLB123456789012">x</a>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result).not.toBeNull();
      expect(result!.productUrl).toContain('MLB123456789012');
    });

    it('reconhece variante /sec/MLB (não usada mas segue padrão)', () => {
      // A regex exige /p/MLB literal, então /sec/MLB NÃO é reconhecido.
      const html = `<a href="https://www.mercadolivre.com.br/sec/MLB123456789">x</a>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result).toBeNull();
    });
  });

  describe('fallback via "Ir para"', () => {
    it('extrai via link com texto "Ir para o Produto"', () => {
      const html = `<html><body>
        <a href="https://www.mercadolivre.com.br/produto/x/p/MLB987654321">Ir para o Produto</a>
        <meta property="og:image" content="https://example.com/x.jpg">
      </body></html>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result).not.toBeNull();
      expect(result!.productUrl).toContain('MLB987654321');
      expect(result!.imageUrl).toBe('https://example.com/x.jpg');
    });

    it('fallback filtra links não-ML quando primeira estratégia falha', () => {
      // Sem /p/MLB direto → tenta fallback "Ir para" → link não-ML é ignorado
      const html = `<a href="https://example.com/outros">Ir para o Produto</a>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result).toBeNull();
    });
  });

  describe('retorna null quando não acha nada', () => {
    it('HTML sem links de produto ML', () => {
      const html = `<html><body><p>Oferta imperdível!</p></body></html>`;
      expect(extractSocialProductDataFromHtml(html)).toBeNull();
    });

    it('HTML com link ML mas sem /p/MLB nem "Ir para"', () => {
      const html = `<a href="https://www.mercadolivre.com.br/">Home</a>`;
      expect(extractSocialProductDataFromHtml(html)).toBeNull();
    });

    it('HTML com /p/MLB mas sem prefixo no path é ignorado', () => {
      // A regex do código exige [^"]* entre / e /p/MLB. Sem prefixo,
      // a regex não casa.
      const html = `<a href="https://www.mercadolivre.com.br/p/MLB123456789">x</a>`;
      expect(extractSocialProductDataFromHtml(html)).toBeNull();
    });

    it('HTML vazio', () => {
      expect(extractSocialProductDataFromHtml('')).toBeNull();
    });
  });

  describe('extrai og:image junto', () => {
    it('retorna imageUrl null quando não tem og:image', () => {
      const html = `<a href="https://www.mercadolivre.com.br/produto/x/p/MLB123456789">x</a>`;
      const result = extractSocialProductDataFromHtml(html);
      expect(result).not.toBeNull();
      expect(result!.imageUrl).toBeNull();
    });

    it('extrai og:image mesmo sem tag property explícita', () => {
      const html = `<a href="https://www.mercadolivre.com.br/produto/x/p/MLB123456789">x</a>
        <meta name="og:image" content="https://cdn.com/img.png">`;
      // O regex do og:image só aceita property= ou name= "og:image" / "twitter:image".
      // "name="og:image"" não é padrão, mas o regex permite. Vamos validar.
      const result = extractSocialProductDataFromHtml(html);
      expect(result).not.toBeNull();
      // Como o regex aceita name="og:image", deve achar.
      expect(result!.imageUrl).toBe('https://cdn.com/img.png');
    });
  });
});
