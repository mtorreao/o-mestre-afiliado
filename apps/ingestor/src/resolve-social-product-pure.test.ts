/**
 * Testes das funções PURAS em apps/ingestor/src/resolve-social-product-pure.ts.
 *
 * `extractSocialProductDataFromHtml` e `extractOgImage` já são cobertas por
 * resolve-social-product.test.ts (via re-export). Este arquivo cobre as
 * funções extraídas na rodada 3: stripUrlParams, isMlProductPageUrl,
 * extractMlProductHref, extractIrParaProdutoHref, buildResolutionFromFinalUrl
 * e normalizeBrowserImageContent.
 */
import { describe, expect, it } from 'bun:test';
import {
  stripUrlParams,
  isMlProductPageUrl,
  extractMlProductHref,
  extractIrParaProdutoHref,
  buildResolutionFromFinalUrl,
  normalizeBrowserImageContent,
  extractSocialProductDataFromHtml,
  extractOgImage,
} from './resolve-social-product-pure.ts';

// ─── extractOgImage ────────────────────────────────────────────────────

describe('extractOgImage (pure module)', () => {
  it('extrai property antes de content', () => {
    expect(extractOgImage('<meta property="og:image" content="https://img/a.webp">')).toBe(
      'https://img/a.webp',
    );
  });

  it('extrai content antes de property (segundo pattern)', () => {
    expect(extractOgImage('<meta content="https://img/b.webp" property="og:image">')).toBe(
      'https://img/b.webp',
    );
  });

  it('retorna null sem og:image/twitter:image', () => {
    expect(extractOgImage('<html><head></head></html>')).toBeNull();
  });

  /**
   * Bug 2026-07-30: Mercado Livre devolve og:image com template literal
   * `{sanitized_title}` em URLs do padrão `D_Q_NP_*.webp`. Esse padrão
   * NÃO é uma URL real — só é resolvido via JS no browser. Quando o
   * ingestor aceita a URL-template como imageUrl, o `fetchProductImage`
   * grava no cache e o `sendMedia` falha no WhatsApp como 404.
   *
   * Esperado: o parser REJEITA a URL-template (retorna null), permitindo
   * que o fallback (`og:image` em /p/MLB, ou `fetchOgImage` na página
   * final) produza uma URL real.
   */
  it('rejeita og:image do ML com template literal {sanitized_title}', () => {
    const html =
      '<meta property="og:image" content="https://http2.mlstatic.com/D_Q_NP_727559-MLA99590035560_122025-AB{sanitized_title}.webp">';
    expect(extractOgImage(html)).toBeNull();
  });

  it('rejeita twitter:image com template literal {qualquer_coisa}', () => {
    const html =
      '<meta name="twitter:image" content="https://cdn.example.com/D_Q_NP_x-{title}.jpg">';
    expect(extractOgImage(html)).toBeNull();
  });

  /**
   * Regressão: se og:image vier com placeholder, NÃO descartar o
   * twitter:image que estiver no mesmo HTML. O parser deve pular o
   * candidato rejeitado e continuar procurando.
   */
  it('cai no twitter:image quando og:image tem placeholder', () => {
    const html =
      '<meta property="og:image" content="https://http2.mlstatic.com/D_Q_NP_x-{sanitized_title}.webp">' +
      '<meta name="twitter:image" content="https://cdn.example.com/real.jpg">';
    expect(extractOgImage(html)).toBe('https://cdn.example.com/real.jpg');
  });

  it('cai no og:image quando twitter:image tem placeholder', () => {
    const html =
      '<meta name="twitter:image" content="https://cdn.example.com/{slug}.jpg">' +
      '<meta property="og:image" content="https://cdn.example.com/real.jpg">';
    expect(extractOgImage(html)).toBe('https://cdn.example.com/real.jpg');
  });
});

// ─── stripUrlParams ────────────────────────────────────────────────────

describe('stripUrlParams', () => {
  it('remove query e hash', () => {
    expect(stripUrlParams('https://www.mercadolivre.com.br/x/p/MLB123?matt_word=abc#frag')).toBe(
      'https://www.mercadolivre.com.br/x/p/MLB123',
    );
  });

  it('mantém URL sem params intacta', () => {
    expect(stripUrlParams('https://www.mercadolivre.com.br/x/p/MLB123')).toBe(
      'https://www.mercadolivre.com.br/x/p/MLB123',
    );
  });

  it('retorna original quando URL inválida', () => {
    expect(stripUrlParams('não é uma url')).toBe('não é uma url');
  });
});

// ─── isMlProductPageUrl ────────────────────────────────────────────────

describe('isMlProductPageUrl', () => {
  it('aceita /p/MLB<id>', () => {
    expect(isMlProductPageUrl('https://www.mercadolivre.com.br/slug/p/MLB12345')).toBe(true);
    expect(isMlProductPageUrl('https://x.com/P/mlb99')).toBe(true);
  });

  it('rejeita /social/, listas e URLs sem /p/MLB', () => {
    expect(isMlProductPageUrl('https://www.mercadolivre.com.br/social/om123')).toBe(false);
    expect(isMlProductPageUrl('https://www.mercadolivre.com.br/ofertas')).toBe(false);
  });
});

// ─── extractMlProductHref ──────────────────────────────────────────────

describe('extractMlProductHref', () => {
  it('extrai e normaliza href de produto (strip de tracking)', () => {
    const html =
      '<a href="https://www.mercadolivre.com.br/tenis/p/MLB123?matt_word=outro#a">Ver</a>';
    expect(extractMlProductHref(html)).toBe('https://www.mercadolivre.com.br/tenis/p/MLB123');
  });

  it('aceita host sem www', () => {
    const html = '<a href="https://mercadolivre.com.br/x/p/MLB77">x</a>';
    expect(extractMlProductHref(html)).toBe('https://mercadolivre.com.br/x/p/MLB77');
  });

  it('retorna null sem href de produto', () => {
    expect(extractMlProductHref('<a href="https://outrosite.com/p/MLB1">x</a>')).toBeNull();
    expect(extractMlProductHref('<html>nada</html>')).toBeNull();
  });
});

// ─── extractIrParaProdutoHref ──────────────────────────────────────────

describe('extractIrParaProdutoHref', () => {
  it('extrai link "Ir para o Produto" do host ML', () => {
    const html =
      '<a href="https://produto.mercadolivre.com.br/MLB-321-tenis?ref=x">Ir para o Produto</a>';
    expect(extractIrParaProdutoHref(html)).toBe(
      'https://produto.mercadolivre.com.br/MLB-321-tenis',
    );
  });

  it('rejeita host fora de mercadolivre.com.br', () => {
    const html = '<a href="https://phishing.example/MLB-1">Ir para o Produto</a>';
    expect(extractIrParaProdutoHref(html)).toBeNull();
  });

  it('retorna null sem âncora "Ir para"', () => {
    expect(extractIrParaProdutoHref('<a href="https://mercadolivre.com.br/x">Ver</a>')).toBeNull();
  });
});

// ─── buildResolutionFromFinalUrl ───────────────────────────────────────

describe('buildResolutionFromFinalUrl', () => {
  it('monta resolução de URL final /p/MLB com strip de params', () => {
    expect(
      buildResolutionFromFinalUrl(
        'https://www.mercadolivre.com.br/x/p/MLB55?tracking=1',
        'https://img/og.webp',
      ),
    ).toEqual({
      productUrl: 'https://www.mercadolivre.com.br/x/p/MLB55',
      imageUrl: 'https://img/og.webp',
    });
  });

  it('retorna null para URL que não é produto', () => {
    expect(
      buildResolutionFromFinalUrl('https://www.mercadolivre.com.br/social/om1', null),
    ).toBeNull();
  });

  it('retorna null para finalUrl ausente', () => {
    expect(buildResolutionFromFinalUrl(null, null)).toBeNull();
    expect(buildResolutionFromFinalUrl(undefined, null)).toBeNull();
    expect(buildResolutionFromFinalUrl('', null)).toBeNull();
  });
});

// ─── normalizeBrowserImageContent ──────────────────────────────────────

describe('normalizeBrowserImageContent', () => {
  it('trim de conteúdo válido', () => {
    expect(normalizeBrowserImageContent('  https://img/x.jpg  ')).toBe('https://img/x.jpg');
  });

  it('vazio/whitespace/null/undefined → null', () => {
    expect(normalizeBrowserImageContent('')).toBeNull();
    expect(normalizeBrowserImageContent('   ')).toBeNull();
    expect(normalizeBrowserImageContent(null)).toBeNull();
    expect(normalizeBrowserImageContent(undefined)).toBeNull();
  });
});

// ─── extractSocialProductDataFromHtml (composição das novas puras) ─────

describe('extractSocialProductDataFromHtml (composição)', () => {
  it('href inválido no fallback "Ir para" não explode (URL malformada)', () => {
    // Sem href de produto /p/MLB e com âncora "Ir para" cujo href não parseia
    // como URL — cai no catch e retorna null.
    const html = '<a href="https://">Ir para o Produto</a>';
    expect(extractSocialProductDataFromHtml(html)).toBeNull();
  });

  it('usa fallback "Ir para" quando não há href /p/MLB direto', () => {
    const html = `
      <meta property="og:image" content="https://img/social.webp">
      <a href="https://produto.mercadolivre.com.br/MLB-999-item?matt_word=x">Ir para o Produto</a>
    `;
    expect(extractSocialProductDataFromHtml(html)).toEqual({
      productUrl: 'https://produto.mercadolivre.com.br/MLB-999-item',
      imageUrl: 'https://img/social.webp',
    });
  });
});
