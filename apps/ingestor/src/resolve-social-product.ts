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
 */
import { incrementCounter } from '@omestre/worker-common';
import type { Browser, Page } from 'playwright-core';

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'ingestor',
    message,
    ...(data && typeof data === 'object' ? data : {}),
  }));
}

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
 * Tenta extrair a URL do produto do HTML da página /social/.
 * O botão "Ir para o Produto" geralmente é um <a> com href para /p/MLB<id>.
 */
async function tryExtractFromHtml(socialUrl: string): Promise<string | null> {
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
    const html = await res.text();

    // Procura hrefs que apontam para /p/MLB<id> (página de produto clássica)
    const productUrlMatch = html.match(
      /href="(https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^"]*\/p\/MLB\d+[^"]*)"/i,
    );
    if (productUrlMatch?.[1]) {
      // Limpa params de tracking
      try {
        const u = new URL(productUrlMatch[1]);
        u.search = '';
        u.hash = '';
        return u.toString();
      } catch {
        return productUrlMatch[1];
      }
    }

    // Fallback: procura qualquer link com "Ir para" no texto âncora
    const irParaMatch = html.match(
      /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>[^<]*Ir\s+para[^<]*<\/a>/i,
    );
    if (irParaMatch?.[1]) {
      try {
        const u = new URL(irParaMatch[1]);
        if (/mercadolivre\.com\.br/i.test(u.hostname)) {
          u.search = '';
          u.hash = '';
          return u.toString();
        }
      } catch {
        // ignora
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ─── Estratégia 2: headless browser ────────────────────────────────────

async function tryWithBrowser(socialUrl: string): Promise<string | null> {
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
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: CLICK_TIMEOUT_MS }).catch(() => null),
            el.click({ timeout: CLICK_TIMEOUT_MS }),
          ]);

          const finalUrl = response?.url() ?? page.url();
          if (finalUrl && /\/p\/MLB\d+/i.test(finalUrl)) {
            const u = new URL(finalUrl);
            u.search = '';
            u.hash = '';
            return u.toString();
          }

          // Se clicou mas não foi para /p/MLB, tenta extrair do HTML da nova página
          const html = await page.content();
          const match = html.match(
            /href="(https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^"]*\/p\/MLB\d+[^"]*)"/i,
          );
          if (match?.[1]) {
            const u = new URL(match[1]);
            u.search = '';
            u.hash = '';
            return u.toString();
          }
        }
      } catch {
        // Tenta próximo seletor
      }
    }

    // Fallback: extrai do HTML da página /social/ sem clicar
    const html = await page.content();
    const match = html.match(
      /href="(https?:\/\/(?:www\.)?mercadolivre\.com\.br\/[^"]*\/p\/MLB\d+[^"]*)"/i,
    );
    if (match?.[1]) {
      const u = new URL(match[1]);
      u.search = '';
      u.hash = '';
      return u.toString();
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
      await page.context().close().catch(() => {});
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
 * @returns URL do produto real, ou null se não conseguiu resolver
 */
export async function resolveSocialProductUrl(socialUrl: string): Promise<string | null> {
  log('info', 'Resolvendo /social/ para URL de produto real', { socialUrl });

  // Estratégia 1: fetch + parse (rápido)
  const fromHtml = await tryExtractFromHtml(socialUrl);
  if (fromHtml) {
    log('info', '/social/ resolvido via HTML (sem browser)', {
      socialUrl,
      productUrl: fromHtml,
    });
    return fromHtml;
  }

  // Estratégia 2: headless browser
  const fromBrowser = await tryWithBrowser(socialUrl);
  if (fromBrowser) {
    log('info', '/social/ resolvido via headless browser', {
      socialUrl,
      productUrl: fromBrowser,
    });
    return fromBrowser;
  }

  log('warn', 'Não foi possível resolver /social/ para produto', { socialUrl });
  return null;
}