/**
 * Extração e classificação de URLs de marketplace em texto cru.
 *
 * Funções puras (testadas em ingestor.test.ts):
 *  - classifyLinkKind(url): classifica produto / cupom / outro
 *  - extractAllMarketplaceLinks(text): extrai todos os links de marketplace
 *  - extractMarketplaceUrl(text): primeira URL (não-cupom preferida)
 *  - sanitizeNonOfferLinks(text): remove t.me, separadores órfãos, etc.
 *
 * Estas funções não fazem I/O — apenas regex sobre o texto. A separação
 * de redirectors (meli.la, s.shopee) é responsabilidade de
 * resolve-redirect.ts (chamado depois, em pipeline).
 */
import { detectMarketplace } from '@omestre/shared';

/**
 * Tipo de link de marketplace extraído de uma mensagem.
 * - 'product': URL de página de PRODUTO (tem padrão de item claro)
 * - 'coupon':  link de CUPOM / voucher / redirector de afiliado
 * - 'other':   marketplace detectado mas sem padrão de produto claro
 *              (ex.: shortlink s.shopee.com.br não resolvido)
 */
export type LinkKind = 'product' | 'coupon' | 'other';

export interface ExtractedLink {
  url: string;
  kind: LinkKind;
}

/**
 * Classifica um link de marketplace em produto / cupom / outro.
 * Usa padrões de URL — NÃO resolve redirects (economia de rede).
 */
export function classifyLinkKind(url: string): LinkKind {
  // Redirector de cupom conhecido (go.promozone.ai/*) sempre é cupom
  if (/go\.promozone\.ai/i.test(url)) return 'coupon';
  // Shortlinks Shopee (s.shopee.com.br/XXX) — affiliate/cupom/voucher:
  // não temos como saber se é produto sem resolver o redirect (que é
  // feito em outro passo). Marcamos como 'coupon' para que o pipeline
  // não tente extrair imagem do shortlink e não use o shortlink como
  // originalLink no dedup. O `resolveRedirectUrl` depois, se conseguir
  // extrair um itemId real, promove a URL para o caminho de produto.
  if (/s\.shopee\.com\.br/i.test(url)) return 'coupon';
  // URLs de cupom/voucher óbvias
  if (/voucher-wallet|cupom|\/claim\b|\/coupons?\b|\/voucher\b/i.test(url)) return 'coupon';
  // Shopee produto: -i.SHOPID.ITEMID (o "i." pode vir após slug com hífen;
  // ITEMID e SHOPID são separados por ponto na URL real)
  if (/(^|[\/-])i\.\d+[./]\d+/i.test(url)) return 'product';
  // MercadoLivre produto: MLBxxxx, /p/MLB, meli.la (oferta ML)
  if (
    /(^|\/|\.)(MLB|MLM|MLA|MCO|MLC)\d{8,}/i.test(url) ||
    /\/p\/MLB/i.test(url) ||
    /meli\.la\//i.test(url)
  )
    return 'product';
  // Amazon produto: /dp/ASIN ou /gp/product/ASIN
  if (/\/dp\/[A-Z0-9]{10}/i.test(url) || /\/gp\/product\/[A-Z0-9]{10}/i.test(url)) return 'product';
  // Demais (s.shopee.com.br shortlink não resolvido, magalu, etc.)
  return 'other';
}

/**
 * Extrai TODOS os links de marketplace de um texto, classificando cada um.
 * Substitui extractMarketplaceUrl (que pegava só o primeiro).
 */
export function extractAllMarketplaceLinks(text: string): ExtractedLink[] {
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const urls = text.match(urlRegex);
  if (!urls) return [];

  const result: ExtractedLink[] = [];
  for (const url of urls) {
    const marketplace = detectMarketplace(url);
    if (marketplace === 'unknown') continue;
    result.push({ url, kind: classifyLinkKind(url) });
  }
  return result;
}

/**
 * Extrai a URL de marketplace da mensagem (compatibilidade).
 * Pega o primeiro link não-cupom — mantém o comportamento antigo para
 * chamadores que não tratam múltiplos links.
 */
export function extractMarketplaceUrl(text: string): string | null {
  const links = extractAllMarketplaceLinks(text);
  if (links.length === 0) return null;
  const nonCoupon = links.find((l) => l.kind !== 'coupon');
  return (nonCoupon ?? links[0]!).url;
}

/**
 * Remove links que não fazem parte da oferta do texto.
 * Atualmente remove links de Telegram (t.me/*) — canais/grupos que são
 * divulgação do bot original, não parte da oferta em si.
 *
 * Exemplo: "#MercadoLivre #Parceria | t.me/cuponsm"
 *       →  "#MercadoLivre #Parceria"
 */
export function sanitizeNonOfferLinks(text: string): string {
  // Remove URLs de Telegram (t.me/*)
  let sanitized = text.replace(/https?:\/\/t\.me\/[^\s<>"']+/gi, '');
  // Remove separadores órfãos no final de linha (ex.: "| " sem link)
  sanitized = sanitized.replace(/\s*\|\s*$/gm, '');
  // Limpa espaços extras
  sanitized = sanitized.replace(/[ \t]{2,}/g, ' ');
  // Remove linhas vazias extras
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');
  return sanitized.trim();
}
