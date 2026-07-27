/**
 * resolve-social-product.ts
 *
 * Resolve URLs /social/<id> do Mercado Livre para a URL real do produto.
 *
 * Páginas /social/<id> são social commerce: mostram um produto com preço,
 * vendedor e um botão "Ir para o Produto" que leva à página clássica
 * /p/MLB<id>. O Link Builder do ML rejeita /social/ (erro 111), então
 * precisamos extrair a URL real do produto antes de converter.
 *
 * Estratégia:
 *   1. Tenta extrair o link do HTML via fetch (página server-rendered)
 *   2. Se não achar, usa headless browser (Playwright) para clicar no botão
 *
 * O browser é singleton (lazy init) e reutilizado entre chamadas.
 *
 * Toda a lógica PURA de parse/normalização vive em
 * `resolve-social-product-pure.ts` (coberta por resolve-social-product-pure.test.ts).
 */
import { makeLogger } from '@omestre/shared';
import type { Browser, Page } from 'playwright-core';
import type { SocialProductResolution } from './resolve-social-product-pure.ts';
import {
  extractOgImage,
  extractSocialProductDataFromHtml,
  extractMlProductHref,
  buildResolutionFromFinalUrl,
  normalizeBrowserImageContent,
} from './resolve-social-product-pure.ts';

// Re-exports para compatibilidade com consumidores/testes antigos.
export type { SocialProductResolution } from './resolve-social-product-pure.ts';
export { extractSocialProductDataFromHtml } from './resolve-social-product-pure.ts';

/** Exportado apenas para teste unitário. */
export const _testExtractOgImage = extractOgImage;

const log = makeLogger('ingestor');

// ─── Config ────────────────────────────────────────────────────────────
const NAV_TIMEOUT_MS = 20_000;
const CLICK_TIMEOUT_MS = 10_000;

// ─── Singleton browser ─────────────────────────────────────────────────
let browserInstance: Browser | null = null;
let browserLaunching: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserInstance?.isConnected()) return browserInstance;
  if (browserLaunching) return browserLaunching;

  browserLaunching = (async () => {
    // Dynamic import para não carregar playwright se não precisar
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    browser.on('disconnected', () => {
      log('warn', 'Browser desconectado — será relançado na próxima chamada');
      browserInstance = null;
      browserLaunching = null;
    });
    browserInstance = browser;
    browserLaunching = null;
    log('info', 'Headless browser iniciado para resolução de /social/');
    return browser;
  })();

  return browserLaunching;
}

/** Encerra o browser (chamar no shutdown do processo). */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    browserLaunching = null;
  }
}

// ─── Estratégia 1: fetch + parse HTML ──────────────────────────────────

/**
 * Tenta extrair a URL do produto e a imagem do HTML da página /social/.
 */
async function tryExtractFromHtml(socialUrl: string): Promise<SocialProductResolution | null> {
  try {
    const res = await fetch(socialUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(NAV_TIMEOUT_MS),
    });

    if (!res.ok) return null;
    return extractSocialProductDataFromHtml(await res.text());
  } catch {
    return null;
  }
}

// ─── Estratégia 2: headless browser ────────────────────────────────────

async function extractBrowserImage(page: Page): Promise<string | null> {
  const content = await page
    .locator('meta[property="og:image"], meta[name="twitter:image"]')
    .first()
    .getAttribute('content')
    .catch(() => null);
  return normalizeBrowserImageContent(content);
}

async function tryWithBrowser(socialUrl: string): Promise<SocialProductResolution | null> {
  let page: Page | null = null;
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      viewport: { width: 1280, height: 720 },
    });
    page = await context.newPage();

    await page.goto(socialUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });

    // Tenta encontrar o botão "Ir para o Produto" por texto
    const selectors = [
      'a:has-text("Ir para o Produto")',
      'a:has-text("Ir para produto")',
      'button:has-text("Ir para o Produto")',
      'button:has-text("Ir para produto")',
      'a:has-text("Ir para")',
      '[data-testid="action:under-image-button"] a',
      '.ui-pdp-container__row--actions a',
    ];

    for (const selector of selectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 2000 })) {
          // Captura a navegação resultante do clique
          const [response] = await Promise.all([
            page
              .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: CLICK_TIMEOUT_MS })
              .catch(() => null),
            el.click({ timeout: CLICK_TIMEOUT_MS }),
          ]);

          const finalUrl = response?.url() ?? page.url();
          const fromNavigation = buildResolutionFromFinalUrl(
            finalUrl,
            await extractBrowserImage(page),
          );
          if (fromNavigation) return fromNavigation;

          // Se clicou mas não foi para /p/MLB, tenta extrair do HTML da nova página
          const html = await page.content();
          const productUrl = extractMlProductHref(html);
          if (productUrl) {
            return {
              productUrl,
              imageUrl: await extractBrowserImage(page),
            };
          }
        }
      } catch {
        // Tenta próximo seletor
      }
    }

    // Fallback: extrai do HTML da página /social/ sem clicar
    const html = await page.content();
    const productUrl = extractMlProductHref(html);
    if (productUrl) {
      return {
        productUrl,
        imageUrl: await extractBrowserImage(page),
      };
    }

    return null;
  } catch (err) {
    log('warn', 'Erro ao resolver /social/ com browser', {
      socialUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    if (page) {
      await page
        .context()
        .close()
        .catch(() => {});
    }
  }
}

// ─── API pública ───────────────────────────────────────────────────────

/**
 * Resolve uma URL /social/<id> do ML para a URL real do produto (/p/MLB<id>).
 *
 * Tenta primeiro via fetch+parse HTML (rápido, sem browser).
 * Se não achar, usa headless browser para clicar em "Ir para o Produto".
 *
 * @returns URL e imagem do produto real, ou null se não conseguiu resolver
 */
export async function resolveSocialProductUrl(
  socialUrl: string,
): Promise<SocialProductResolution | null> {
  log('info', 'Resolvendo /social/ para URL de produto real', { socialUrl });

  // Estratégia 1: fetch + parse (rápido)
  const fromHtml = await tryExtractFromHtml(socialUrl);
  if (fromHtml) {
    log('info', '/social/ resolvido via HTML (sem browser)', {
      socialUrl,
      productUrl: fromHtml.productUrl,
      imageUrl: fromHtml.imageUrl,
    });
    return fromHtml;
  }

  // Estratégia 2: headless browser
  const fromBrowser = await tryWithBrowser(socialUrl);
  if (fromBrowser) {
    log('info', '/social/ resolvido via headless browser', {
      socialUrl,
      productUrl: fromBrowser.productUrl,
      imageUrl: fromBrowser.imageUrl,
    });
    return fromBrowser;
  }

  log('warn', 'Não foi possível resolver /social/ para produto', { socialUrl });
  return null;
}
