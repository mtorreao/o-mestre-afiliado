/**
 * Script de debug — Testa extração de imagem de produtos Shopee.
 *
 * Uso:
 *   bun run src/debug-shopee-image.ts <url-shopee>
 *   bun run src/debug-shopee-image.ts "https://shopee.com.br/Perfume-...-i.1006874942.23694247133"
 *
 * Testa todas as estratégias: GraphQL API, og:image, CDN direto, etc.
 */
import { createHash } from 'node:crypto';

// ─── Config ───────────────────────────────────────────────────────────

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const SHOPEE_API = 'https://open-api.affiliate.shopee.com.br/graphql';
const TIMEOUT = 8_000;

const SHOPEE_APP_ID = process.env.SHOPEE_APP_ID || '';
const SHOPEE_SECRET = process.env.SHOPEE_SECRET || '';

// ─── Helpers ──────────────────────────────────────────────────────────

function log(label: string, value: unknown) {
  console.log(`  ${label.padEnd(30)} ${value}`);
}

function extractItemId(url: string): string | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[2]) return m[2];
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[2]) return productMatch[2];
  return null;
}

function extractShopId(url: string): string | null {
  const m = url.match(/-i\.(\d+)\.(\d+)/i);
  if (m?.[1]) return m[1];
  const productMatch = url.match(/\/product\/(\d+)\/(\d+)/i);
  if (productMatch?.[1]) return productMatch[1];
  return null;
}

function extractSlug(url: string): string | null {
  const m = url.match(/shopee\.com\.br\/([^/?#]+)-i\./i);
  if (m?.[1]) return decodeURIComponent(m[1]);
  return null;
}

function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

// ─── Estratégia 1: GraphQL Affiliate API ───────────────────────────────

async function testGraphQL(url: string) {
  console.log('\n📡 Estratégia 1: GraphQL Affiliate API (productOfferV2)');

  if (!SHOPEE_APP_ID || !SHOPEE_SECRET) {
    console.log('  ⚠️  SHOPEE_APP_ID/SECRET não configurados — pulando');
    return null;
  }

  const itemId = extractItemId(url);
  const shopId = extractShopId(url);

  log('itemId', itemId);
  log('shopId', shopId);

  if (!itemId || !shopId) {
    log('ERRO', 'Não foi possível extrair itemId/shopId da URL');
    return null;
  }

  // ── productOfferV2 com itemId+shopId ──
  const body = JSON.stringify({
    query: `query {
      productOfferV2(itemId: ${parseInt(itemId, 10)}, shopId: ${parseInt(shopId, 10)}) {
        nodes {
          itemId
          shopId
          productName
          imageUrl
          offerLink
          price
          priceMin
          priceMax
          commissionRate
        }
      }
    }`,
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${SHOPEE_APP_ID}${timestamp}${body}${SHOPEE_SECRET}`;
  const signature = createHash('sha256').update(payload).digest('hex');

  try {
    const start = performance.now();
    const res = await fetch(SHOPEE_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `SHA256 Credential=${SHOPEE_APP_ID}, Timestamp=${timestamp}, Signature=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const elapsed = Math.round(performance.now() - start);
    log('Status', `${res.status} (${elapsed}ms)`);

    const data = (await res.json()) as Record<string, unknown>;

    if (data.errors) {
      const errors = data.errors as Array<{ message: string; extensions?: { code?: number } }>;
      for (const err of errors) {
        log('Erro API', `[${err.extensions?.code ?? '?'}] ${err.message}`);
      }
      return null;
    }

    const dataNode = data.data as Record<string, unknown> | undefined;
    const offerV2 = dataNode?.productOfferV2 as
      { nodes?: Array<Record<string, unknown>> } | undefined;
    const nodes = offerV2?.nodes;

    if (nodes && nodes.length > 0) {
      const first = nodes[0]!;
      log('productName', first.productName as string);
      log('imageUrl', first.imageUrl as string);
      log('offerLink', (first.offerLink as string)?.slice(0, 80));
      if (first.imageUrl) return first.imageUrl as string;
    } else {
      log('Resultado', 'Nenhum node retornado (produto pode não estar no programa de afiliados)');
    }

    // ── Fallback: productOfferV2 com keyword ──
    const slug = extractSlug(url);
    if (slug) {
      log('\n  → Fallback: productOfferV2 por keyword:', slug.slice(0, 60));

      const cleanKeyword = slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

      const body2 = JSON.stringify({
        query: `query {
          productOfferV2(keyword: "${cleanKeyword.replace(/"/g, '\\"')}", limit: 5, sortType: 1) {
            nodes {
              itemId
              shopId
              productName
              imageUrl
              offerLink
              price
            }
          }
        }`,
      });

      const ts2 = Math.floor(Date.now() / 1000);
      const sig2 = createHash('sha256')
        .update(`${SHOPEE_APP_ID}${ts2}${body2}${SHOPEE_SECRET}`)
        .digest('hex');

      const res2 = await fetch(SHOPEE_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Credential=${SHOPEE_APP_ID}, Timestamp=${ts2}, Signature=${sig2}`,
        },
        body: body2,
        signal: AbortSignal.timeout(TIMEOUT),
      });

      const data2 = (await res2.json()) as Record<string, unknown>;

      if (data2.errors) {
        const errs = data2.errors as Array<{ message: string }>;
        log('Erro keyword', errs[0]?.message ?? 'desconhecido');
        return null;
      }

      const nodes2 = (
        (data2.data as Record<string, unknown>)?.productOfferV2 as {
          nodes?: Array<Record<string, unknown>>;
        }
      )?.nodes;
      if (nodes2 && nodes2.length > 0) {
        const best = nodes2[0]!;
        log('→ productName', best.productName as string);
        log('→ imageUrl', best.imageUrl as string);
        if (best.imageUrl) return best.imageUrl as string;
      } else {
        log('Resultado keyword', 'Nenhum resultado');
      }
    }
  } catch (err) {
    log('Exception', err instanceof Error ? err.message : String(err));
  }

  return null;
}

// ─── Estratégia 2: og:image da página ──────────────────────────────────

async function testOgImage(url: string) {
  console.log('\n🖼️  Estratégia 2: og:image da página');

  try {
    const start = performance.now();
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    const elapsed = Math.round(performance.now() - start);
    log('Status', `${res.status} (${elapsed}ms)`);
    log('Final URL', res.url.slice(0, 100));

    const html = await res.text();
    log('HTML size', `${html.length} bytes`);

    // og:image
    const ogPatterns = [
      /<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*?content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]*?(?:property|name)=["'](?:og:image|twitter:image)["']/i,
    ];
    for (const re of ogPatterns) {
      const m = html.match(re);
      if (m?.[1]) {
        log('og:image', m[1].slice(0, 120));
        return m[1];
      }
    }
    log('og:image', 'NÃO encontrado');
  } catch (err) {
    log('Exception', err instanceof Error ? err.message : String(err));
  }
  return null;
}

// ─── Estratégia 3: CDN direto ──────────────────────────────────────────

async function testCdn(url: string) {
  console.log('\n☁️  Estratégia 3: CDN Shopee direto');

  const itemId = extractItemId(url);
  const shopId = extractShopId(url);
  log('itemId', itemId);
  log('shopId', shopId);

  if (!itemId) {
    log('ERRO', 'Não foi possível extrair itemId');
    return null;
  }

  const candidates = [
    // Formatos atuais
    `https://cf.shopee.com.br/file/${itemId}_tn`,
    `https://down-br.img.susercontent.com/file-${itemId}_tn`,
    `https://cf.shopee.com.br/file/${itemId}`,
    `https://down-br.img.susercontent.com/file-${itemId}`,
    // Com shopId
    ...(shopId ? [`https://cf.shopee.com.br/file/${shopId}_${itemId}_tn`] : []),
    // Variações
    `https://cf.shopee.com.br/file/${itemId}_tn.webp`,
    `https://cf.shopee.com.br/file/${itemId}.jpg`,
  ];

  let found = false;
  for (const cdn of candidates) {
    try {
      const start = performance.now();
      const res = await fetch(cdn, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(5_000),
      });
      const elapsed = Math.round(performance.now() - start);
      const ct = res.headers.get('content-type') || '';
      const isImage = res.ok && ct.startsWith('image/');
      const icon = isImage ? '✅' : '❌';
      console.log(
        `  ${icon} ${cdn.slice(0, 90).padEnd(40)} ${res.status} ${ct.slice(0, 30)} (${elapsed}ms)`,
      );
      if (isImage) found = true;
    } catch (e) {
      console.log(`  ⚠️  ${cdn.slice(0, 90).padEnd(40)} ERROR: ${(e as Error).message}`);
    }
  }

  return found ? 'found_via_cdn' : null;
}

// ─── Estratégia 4: api.mercadolibre.com (caso seja ML) ────────────────

async function testMlApi(url: string) {
  const mlMatch = url.match(/ML[BMU]-(\d+)/i);
  if (!mlMatch) return null;

  console.log('\n🔧 Estratégia Extra: API pública ML (por precaução)');
  try {
    const res = await fetch(`https://api.mercadolibre.com/items/${mlMatch[0]}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    log('Status', `${res.status}`);
    if (res.ok) {
      const data = (await res.json()) as { pictures?: Array<{ url: string }>; title?: string };
      log('Title', data.title ?? '(sem título)');
      if (data.pictures?.[0]?.url) {
        log('Image (ML API)', data.pictures[0].url);
        return data.pictures[0].url;
      }
    }
  } catch {
    // não é ML, ignora
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.log('Uso: bun run src/debug-shopee-image.ts <url-shopee>');
    console.log(
      'Ex:  bun run src/debug-shopee-image.ts "https://shopee.com.br/Perfume-...-i.1006874942.23694247133"',
    );
    process.exit(1);
  }

  console.log('═'.repeat(60));
  console.log('🔍 DEBUG: Extração de Imagem Shopee');
  console.log('═'.repeat(60));
  console.log(`\n📌 URL: ${url}`);
  log('itemId', extractItemId(url) ?? 'N/A');
  log('shopId', extractShopId(url) ?? 'N/A');
  log('slug', extractSlug(url) ?? 'N/A');
  log('URL sem query', stripQuery(url));

  let result = await testGraphQL(url);
  if (result) {
    console.log(`\n✅ RESULTADO: ${result}`);
    return;
  }

  result = await testOgImage(url);
  if (result) {
    console.log(`\n✅ RESULTADO: ${result}`);
    return;
  }

  result = await testCdn(url);
  if (result) {
    console.log(`\n✅ RESULTADO: found via CDN`);
    return;
  }

  result = await testMlApi(url);
  if (result) {
    console.log(`\n✅ RESULTADO: ${result}`);
    return;
  }

  console.log('\n❌ NENHUMA ESTRATÉGIA ENCONTROU IMAGEM');
  console.log('\n📋 Próximos passos sugeridos:');
  console.log('  1. Verificar se o produto está no programa de afiliados Shopee');
  console.log('  2. Testar com URL sem query params (extraParams)');
  console.log('  3. Navegar na página com Puppeteer/Playwright (CSR)');
  console.log('  4. Tentar formato alternativo de CDN');
}

main().catch(console.error);
