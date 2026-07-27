/**
 * Testes de resolução de redirects — verifica se shortlinks de marketplace
 * são corretamente resolvidos para URLs de produto reais.
 *
 * Requer: conectividade com Shopee, Mercado Livre, Amazon (HTTP real).
 * Usa URLs de shortlinks observadas em tráfego real dos grupos fonte.
 */
import { describe, expect, test } from 'bun:test';
import { resolveRedirectUrl, isMeliProductUrl } from './resolve-redirect.ts';

// ─── Shopee ────────────────────────────────────────────────────────────

describe('resolveRedirectUrl — Shopee', () => {
  /**
   * s.shopee.com.br/1VxtkMJkHM shortlink real que redireciona para um
   * produto. Antes do fix "HEAD→GET" (2026-07-27), o resolvedor usava HEAD
   * e o Shopee/SGW não retornava o header Location em respostas HEAD
   * (anti-bot), resultando em null → produto classificado como "informative".
   *
   * O formato de destino pode ser:
   *   - Antigo: /...-i.SHOPID.ITEMID (ex: /Controle-Sem-Fio-...-i.1495837089.58258815395)
   *   - Novo (2025+): /<slug>/SHOPID/ITEMID (ex: /opaanlp/1500679968/58256271370)
   * Ambos são páginas de produto reais.
   */
  test('shortlink resolve para URL de produto Shopee (qualquer formato)', async () => {
    const url = 'https://s.shopee.com.br/1VxtkMJkHM';
    const resolved = await resolveRedirectUrl(url);

    // Verifica que resolveu para uma URL diferente (não ficou no shortlink)
    expect(resolved).not.toBe(url);
    // Verifica que a URL resolvida é da Shopee
    const parsed = new URL(resolved);
    expect(parsed.hostname).toMatch(/shopee\.com\.br/);
    // Verifica que contém padrão de produto (formato antigo -i. ou novo /digits/digits)
    const hasOldFormat = /-i\.\d+\.\d+/i.test(parsed.pathname);
    const hasNewFormat = /\/\d{6,}\/\d{6,}/i.test(parsed.pathname);
    expect(hasOldFormat || hasNewFormat).toBe(true);
  });

  /**
   * s.shopee.com.br/1gHJwg5mb4 — shortlink real vindo do grupo
   * Promozone #156 em 2026-07-26 23:51. Redireciona para:
   * /Drone-Profissional-Câmera-para-Fotografia-Aérea-...-i.1569849623.23098872648
   * Com params: gads_t_sig, mmp_pid, uls_trackid, utm_campaign, utm_content,
   * utm_medium, utm_source, utm_term (todos de tracking de afiliado).
   // Antes do fix era rejeitado como "informative" (uty_ params no
   // isLandingPage, HEAD sem Location, formato novo sem -i. não reconhecido).
   // Agora resolve com GET e aceita os novos formatos.
   */
  test('shortlink real Promozone que redireciona para drone produto com tracking params', async () => {
    const url = 'https://s.shopee.com.br/1gHJwg5mb4';
    const resolved = await resolveRedirectUrl(url);

    expect(resolved).not.toBe(url);
    // Verifica que o hostname é shopee
    const parsed = new URL(resolved);
    expect(parsed.hostname).toMatch(/shopee\.com\.br/);
    // Deve conter padrão de produto (qualquer formato)
    const hasOldFormat = /-i\.\d+\.\d+/i.test(parsed.pathname);
    const hasNewFormat = /\/\d{6,}\/\d{6,}/i.test(parsed.pathname);
    expect(hasOldFormat || hasNewFormat).toBe(true);
    // Não deve conter /user/ nem /voucher-wallet (landing pages)
    expect(parsed.pathname).not.toMatch(/^\/user\//);
    expect(parsed.pathname).not.toMatch(/voucher-wallet/);
  });

  /**
   * s.shopee.com.br/8pkV3MdTX8 redireciona para /opaanlp/<shopId>/<itemId>
   * — formato novo (2025+) de URL de produto Shopee, antigamente considerado
   * "landing page" porque o resolvedor com HEAD nunca resolvia (Shopee não
   * retorna Location em HEAD). Agora com GET, resolve para produto real.
   */
  test('shortlink que resolve para produto no formato novo /opaanlp/<shopId>/<itemId>', async () => {
    const url = 'https://s.shopee.com.br/8pkV3MdTX8';
    const resolved = await resolveRedirectUrl(url);

    expect(resolved).not.toBe(url);
    const parsed = new URL(resolved);
    expect(parsed.hostname).toMatch(/shopee\.com\.br/);
    // Formato novo: /<slug>/<shopId>/<itemId>
    expect(parsed.pathname).toMatch(/\/\d{6,}\/\d{6,}/);
  });

  /**
   * s.shopee.com.br/2VqRWKu4aG redireciona para /cart/... — página de
   * carrinho, não produto. Deve manter a URL original.
   */
  test('shortlink que redireciona para /cart/ mantém URL original', async () => {
    const url = 'https://s.shopee.com.br/2VqRWKu4aG';
    const resolved = await resolveRedirectUrl(url);

    expect(resolved).toBe(url);
    expect(resolved).not.toMatch(/-i\.\d+\.\d+/);
  });

  /**
   * s.shopee.com.br/9KglfLaLae redireciona para /opaanlp/<shopId>/<itemId>
   * — mesmo padrão que o anterior. Antes era tratado como landing page
   * (não resolvia com HEAD), agora é produto real com formato novo.
   */
  test('shortlink que resolve para produto /opaanlp/ (2)', async () => {
    const url = 'https://s.shopee.com.br/9KglfLaLae';
    const resolved = await resolveRedirectUrl(url);

    expect(resolved).not.toBe(url);
    const parsed = new URL(resolved);
    expect(parsed.hostname).toMatch(/shopee\.com\.br/);
    expect(parsed.pathname).toMatch(/\/\d{6,}\/\d{6,}/);
  });

  /**
   * Shopee produto com URL direta (não shortlink) — já é URL de produto,
   * não passa por resolver, retorna ela mesma.
   */
  test('URL direta de produto Shopee (não shortlink) retorna ela mesma', async () => {
    const url =
      'https://shopee.com.br/Controle-Sem-Fio-para-Smart-Tv-Pc-Gamer-e-Ps4-Com-Cabo-Carreg%C3%A1vel-Premium-Quality-i.1495837089.58258815395';
    const resolved = await resolveRedirectUrl(url);

    expect(resolved).toBe(url);
  });
});

// ─── Mercado Livre ─────────────────────────────────────────────────────

describe('resolveRedirectUrl — Mercado Livre', () => {
  /**
   * meli.la/2tLscs8 — na data do teste resolveu para:
   * /social/om895584?matt_word=om895584&... (perfil de outro afiliado).
   *
   * IMPORTANTE: no tráfego real dos grupos fonte, 100% dos meli.la
   * resolvem para /social/<outro-afiliado>/lists ou /social/<id> —
   * NUNCA para /p/MLB<id> direto. Isso é esperado (§1.9a) e o
   * convertMlForAffiliate bloqueia esses casos com
   * "meli.la não leva a produto — bloqueando oferta".
   *
   * A resolução em si funciona (retorna a URL canônica do ML),
   * mas o resultado não é produto — testamos só que resolve.
   */
  test('meli.la resolve para URL canônica do ML (social/ de outro afiliado)', async () => {
    const url = 'https://meli.la/2tLscs8';
    const resolved = await resolveRedirectUrl(url);

    // Resolveu para algo (não é a URL curta original)
    expect(resolved).not.toBe(url);
    // Deve ser domínio ML
    expect(resolved).toMatch(/mercadolivre\.com\.br/);
  });

  /**
   * meli.la/2A9nWBB — outro meli.la que resolve para /social/ de outro
   * afiliado. A resolução retorna a URL canônica com params de tracking
   * preservados (para /social/ os params são necessários para o botão
   * "Ir para o Produto").
   */
  test('meli.la resolve para URL canônica mesmo quando é /social/', async () => {
    const url = 'https://meli.la/2A9nWBB';
    const resolved = await resolveRedirectUrl(url);

    // O resolveRedirectUrl retorna a URL canônica (não o shortlink original)
    // porque resolveMeliShortlink retorna um ResolvedMeliRedirect com .url.
    // O bloqueio de /social/ acontece no convertMlForAffiliate, não aqui.
    expect(resolved).not.toBe(url);
    expect(resolved).toMatch(/mercadolivre\.com\.br\/social\//);
  });
});

// ─── isMeliProductUrl ─────────────────────────────────────────────────

describe('isMeliProductUrl', () => {
  /**
   * URL de produto no subdomínio produto.mercadolivre.com.br com formato
   /MLB-{id}-{slug} é extraída da resolução de /social/<id>.
   * BUG: isMeliProductUrl não reconhecia esse formato, o que fazia o
   * convertMlForAffiliate bloquear a oferta mesmo com URL de produto real.
   */
  test('produto.mercadolivre.com.br/MLB-{id} é reconhecido como produto', () => {
    const url =
      'https://produto.mercadolivre.com.br/MLB-3310895673-tnis-fila-recovery-corrida-e-caminhada-masculino-_JM';
    expect(isMeliProductUrl(url)).toBe(true);
  });

  test('/p/MLB{id} clássico continua sendo reconhecido como produto', () => {
    const url = 'https://www.mercadolivre.com.br/forno-de-embutir/p/MLB22019628';
    expect(isMeliProductUrl(url)).toBe(true);
  });

  test('/social/{id} é reconhecido como produto', () => {
    const url = 'https://www.mercadolivre.com.br/social/om895584';
    expect(isMeliProductUrl(url)).toBe(true);
  });

  test('URL de cupom /sec/ NÃO é reconhecida como produto', () => {
    const url = 'https://mercadolivre.com.br/sec/1TTwcDm';
    expect(isMeliProductUrl(url)).toBe(false);
  });

  test('URL de outro domínio NÃO é reconhecida como produto', () => {
    const url = 'https://www.amazon.com.br/dp/B0GLHZQ64K';
    expect(isMeliProductUrl(url)).toBe(false);
  });

  test('/up/MLBU{id} (novo formato universal) é reconhecido como produto', () => {
    const url =
      'https://www.mercadolivre.com.br/camiseta-adidas-masculino-kf2404/up/MLBU3976717095';
    expect(isMeliProductUrl(url)).toBe(true);
  });

  test('/up/MLB{id} (coexistência) é reconhecido como produto', () => {
    const url =
      'https://www.mercadolivre.com.br/kit-15-pares-meias-sport-algodao-cano-medio-sandrini-confort/up/MLB1142202325';
    expect(isMeliProductUrl(url)).toBe(true);
  });

  test('URL /up/{id} SEM MLBU/MLB não é reconhecida como produto', () => {
    const url = 'https://www.mercadolivre.com.br/algum-cupom/up/123';
    expect(isMeliProductUrl(url)).toBe(false);
  });
});

// ─── URLs que não são redirectors ──────────────────────────────────────

describe('resolveRedirectUrl — URLs diretas (não redirectors)', () => {
  test('URL de produto Amazon retorna ela mesma', async () => {
    const url = 'https://www.amazon.com.br/dp/B0GLHZQ64K';
    const resolved = await resolveRedirectUrl(url);

    expect(resolved).toBe(url);
  });

  test('URL que não é de marketplace retorna ela mesma', async () => {
    const url = 'https://example.com/some-page';
    const resolved = await resolveRedirectUrl(url);

    expect(resolved).toBe(url);
  });
});
