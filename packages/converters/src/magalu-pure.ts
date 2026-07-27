/**
 * Lógica PURA do conversor de Magalu (Magazine Luiza / Influenciador Magalu).
 *
 * Separa a detecção, extração e construção de URLs de afiliado da camada de
 * I/O (fetch para resolver shortlinks `maga.lu`). Todas as funções aqui são
 * síncronas, determinísticas e 100% testáveis sem rede.
 *
 * Formato de URL do programa Influenciador Magalu (Magazine Você):
 *   https://www.magazinevoce.com.br/{storeSlug}/{slugProduto}/p/{productId}/{catSlug}/{subCatSlug}/
 *
 * Slug da loja = nome customizado escolhido pelo afiliado no cadastro
 * (3-40 chars, letras minúsculas, números e hífen).
 *
 * O I/O (resolução de shortlinks `maga.lu`) fica em `magalu.ts`,
 * que consome este módulo. Nenhuma chamada de rede aqui.
 */

// ─── Regex / patterns ────────────────────────────────────────────────

/** Shortlink oficial do Magalu (maga.lu/<id>). */
export const MAGALU_SHORTLINK_REGEX = /^https?:\/\/maga\.lu\/([A-Za-z0-9_-]+)/i;

/** ID de produto em URLs magazineluiza.com.br/.../p/<ID>/ ou /oferta/<ID>/ */
export const MAGALU_PRODUCT_ID_REGEX = /\/(?:p|oferta)\/([A-Za-z0-9]+)/i;

/** Path base do magazinevoce.com.br/{slug}/... (captura o slug). */
export const MAGAZINEVOCE_PATH_REGEX =
  /^https?:\/\/(?:www\.)?magazinevoce\.com\.br\/([a-z0-9-]+)\//i;

/** Path completo de produto magazinevoce.com.br/{slug}/{...}/p/<ID>/... */
export const MAGAZINEVOCE_PRODUCT_PATH_REGEX =
  /^https?:\/\/(?:www\.)?magazinevoce\.com\.br\/([a-z0-9-]+)\/(?:[^/?#]+\/)?(?:p|oferta)\/([A-Za-z0-9]+)/i;

/**
 * Path de produto magazineluiza.com.br/p/<ID>/ ou /oferta/<ID>/.
 *
 * Aceita os formatos:
 *   - magazineluiza.com.br/p/<ID>            (curto, sem slug)
 *   - magazineluiza.com.br/<slug>/p/<ID>     (com slug de produto)
 *   - magazineluiza.com.br/<slug>/oferta/<ID>  (formato antigo divulgador)
 *
 * O grupo `(?:[^?#]+\/)?` torna o slug opcional — casa zero ou mais segmentos
 * intermediários.
 */
export const MAGAZINELUIZA_PRODUCT_PATH_REGEX =
  /^https?:\/\/(?:www\.)?magazineluiza\.com\.br\/(?:[^?#]+\/)?(?:p|oferta)\/([A-Za-z0-9]+)/i;

/** Slug de URL go.promozone.ai/magalu/<ID> (captura o ID). */
export const PROMOZONE_MAGALU_REGEX = /go\.promozone\.ai\/magalu\/([A-Za-z0-9_-]+)/i;

/** Slug válido: letras minúsculas, números e hífen, 3-40 chars. */
export const MAGALU_SLUG_REGEX = /^[a-z0-9-]{3,40}$/;

// ─── Detecção ────────────────────────────────────────────────────────

/**
 * Detecta shortlink oficial `maga.lu/<id>`.
 */
export function isMagaluShortlinkPure(url: string): boolean {
  return MAGALU_SHORTLINK_REGEX.test(url);
}

/**
 * Detecta URL de produto em `magazinevoce.com.br/{slug}/.../p/<ID>/...`
 * (Influenciador Magalu).
 */
export function isMagazinevoceProductUrlPure(url: string): boolean {
  return MAGAZINEVOCE_PRODUCT_PATH_REGEX.test(url);
}

/**
 * Detecta URL de produto em `magazineluiza.com.br/{slug}/p/<ID>/` ou
 * `/oferta/<ID>/` (site principal, sem Influenciador).
 */
export function isMagazineluizaProductUrlPure(url: string): boolean {
  return MAGAZINELUIZA_PRODUCT_PATH_REGEX.test(url);
}

/**
 * Detecta se a URL é um link Promozone de Magalu (go.promozone.ai/magalu/<id>).
 * Precisa de resolução de rede para chegar na URL real do produto.
 */
export function isPromozoneMagaluUrlPure(url: string): boolean {
  return PROMOZONE_MAGALU_REGEX.test(url);
}

/**
 * Detecta se a URL é um link OneLink AppsFlyer da Magalu
 * (magazineluiza.onelink.me/...). É um atribuidor de app installs — não
 * uma URL de produto direta. Bloqueamos com mensagem clara no fluxo I/O.
 */
export function isMagaluOnelinkUrlPure(url: string): boolean {
  return /^https?:\/\/(?:www\.)?magazineluiza\.onelink\.me\//i.test(url);
}

/**
 * Detecta qualquer URL de produto Magalu conhecida (magazinevoce, magazineluiza,
 * go.promozone.ai/magalu). Shortlinks maga.lu NÃO são detectados aqui — precisam
 * ser resolvidos primeiro.
 */
export function isMagaluProductUrlPure(url: string): boolean {
  return (
    isMagazinevoceProductUrlPure(url) ||
    isMagazineluizaProductUrlPure(url) ||
    isPromozoneMagaluUrlPure(url)
  );
}

// ─── Extração ────────────────────────────────────────────────────────

/**
 * Extrai o ID do Magalu a partir de um shortlink `go.promozone.ai/magalu/<id>`.
 * Retorna `null` se a URL não for Promozone de Magalu.
 *
 * O ID retornado NÃO é o ID de produto real (esse só existe na URL final após
 * resolução HTTP). É o identificador do shortlink — útil para logging e cache.
 */
export function extractPromozoneMagaluIdPure(url: string): string | null {
  const match = url.match(PROMOZONE_MAGALU_REGEX);
  return match?.[1] ?? null;
}

/**
 * Extrai o ID único do produto Magalu a partir de uma URL.
 *
 * Aceita formatos:
 *   - magazinevoce.com.br/{slug}/.../p/<ID>/...
 *   - magazinevoce.com.br/{slug}/.../oferta/<ID>/...
 *   - magazineluiza.com.br/{slug}/p/<ID>/
 *   - magazineluiza.com.br/{slug}/oferta/<ID>/
 *   - go.promozone.ai/magalu/<shortId>   (shortlink — ID é o shortId, não o real)
 *
 * Retorna `null` se a URL não casar nenhum padrão conhecido.
 */
export function extractMagaluProductIdPure(url: string): string | null {
  // magazinevoce.com.br (Influenciador) — slug + ID
  const mvMatch = url.match(MAGAZINEVOCE_PRODUCT_PATH_REGEX);
  if (mvMatch?.[2]) return mvMatch[2];

  // magazineluiza.com.br — só ID
  const mlMatch = url.match(MAGAZINELUIZA_PRODUCT_PATH_REGEX);
  if (mlMatch?.[1]) return mlMatch[1];

  // go.promozone.ai/magalu/<shortId> — retorna shortId (placeholder até resolve)
  const pzMatch = url.match(PROMOZONE_MAGALU_REGEX);
  if (pzMatch?.[1]) return pzMatch[1];

  // Fallback: regex genérico /p/ ou /oferta/
  const genericMatch = url.match(MAGALU_PRODUCT_ID_REGEX);
  if (genericMatch?.[1]) return genericMatch[1];

  return null;
}

/**
 * Extrai o slug da loja de uma URL `magazinevoce.com.br/{slug}/...`.
 * Retorna `null` se a URL não for do Magazine Você.
 */
export function extractMagazinevoceStoreSlugPure(url: string): string | null {
  const match = url.match(MAGAZINEVOCE_PATH_REGEX);
  return match?.[1] ?? null;
}

/**
 * Extrai o short ID do `maga.lu/<id>`.
 * Retorna `null` se a URL não for um shortlink Magalu.
 */
export function extractMagaluShortlinkIdPure(url: string): string | null {
  const match = url.match(MAGALU_SHORTLINK_REGEX);
  return match?.[1] ?? null;
}

// ─── Validação ──────────────────────────────────────────────────────

/**
 * Valida slug de loja do Influenciador Magalu.
 *
 * Regras:
 *   - apenas letras minúsculas (a-z), números (0-9) e hífen (-)
 *   - 3 a 40 caracteres
 *   - não pode começar nem terminar com hífen
 *   - sem hífens duplos (--)
 */
export interface SlugValidation {
  valid: boolean;
  reason?: string;
}

export function validateMagaluStoreSlugPure(slug: string | null | undefined): SlugValidation {
  if (!slug || typeof slug !== 'string') {
    return { valid: false, reason: 'slug é obrigatório' };
  }
  if (slug.length < 3) {
    return { valid: false, reason: 'slug deve ter no mínimo 3 caracteres' };
  }
  if (slug.length > 40) {
    return { valid: false, reason: 'slug deve ter no máximo 40 caracteres' };
  }
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      reason: 'slug deve conter apenas letras minúsculas, números e hífen',
    };
  }
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { valid: false, reason: 'slug não pode começar nem terminar com hífen' };
  }
  if (slug.includes('--')) {
    return { valid: false, reason: 'slug não pode conter hífens duplos' };
  }
  return { valid: true };
}

// ─── Construção ─────────────────────────────────────────────────────

/**
 * Segmentos opcionais de URL de produto Magalu (slug, categoria, subcategoria).
 * Quando ausentes na URL original, o construtor usa placeholders determinísticos
 * baseados no productId (preserva URL única e estável).
 */
export interface BuildMagaluLinkInput {
  /** URL original do produto Magalu (qualquer formato conhecido). */
  productUrl: string;
  /** Slug da loja do afiliado (já validado). */
  storeSlug: string;
}

/**
 * Constrói a URL de afiliado no formato Influenciador Magalu:
 *   https://www.magazinevoce.com.br/{storeSlug}/{slugProduto}/p/{productId}/{catSlug}/{subCatSlug}/
 *
 * Comportamento:
 *   - Se a URL original é `magazinevoce.com.br/{slugOrigem}/...`, substitui
 *     o slugOrigem por storeSlug mas preserva os outros segmentos.
 *   - Se a URL é `magazineluiza.com.br/p/<ID>/` (sem slug/cat), usa
 *     `produto-<ID>` como slugProduto e placeholders `in/te` para categoria.
 *     Mantém URL estável e única, mas pode não refletir a URL canônica do Magalu.
 *   - Lança Error se productId não puder ser extraído ou storeSlug for inválido.
 */
export function buildMagaluAffiliateLinkPure(input: BuildMagaluLinkInput): string {
  const slugValidation = validateMagaluStoreSlugPure(input.storeSlug);
  if (!slugValidation.valid) {
    throw new Error(`storeSlug inválido: ${slugValidation.reason}`);
  }

  const productId = extractMagaluProductIdPure(input.productUrl);
  if (!productId) {
    throw new Error(`Não foi possível extrair ID do produto Magalu da URL: ${input.productUrl}`);
  }

  // Tenta preservar segmentos opcionais (slugProduto/cat/subcat) se vierem
  // de uma URL magazinevoce.com.br ou magazineluiza.com.br/<slug>/p/<ID>.
  const mvMatch = input.productUrl.match(
    /^https?:\/\/(?:www\.)?magazinevoce\.com\.br\/[a-z0-9-]+\/(.+)$/i,
  );
  if (mvMatch?.[1]) {
    // URL do Magazine Você: troca o slug e preserva o resto do path
    // (que contém slugProduto/p/ID/cat/subcat)
    return `https://www.magazinevoce.com.br/${input.storeSlug}/${mvMatch[1]}`;
  }

  // URL do magazineluiza.com.br/<slug>/p/<ID>/...: preserva os segmentos
  // Exceção: formato curto magazineluiza.com.br/p/<ID>/ (sem slug de produto)
  // → usa placeholder determinístico para gerar URL estável e única
  const mlMatch = input.productUrl.match(
    /^https?:\/\/(?:www\.)?magazineluiza\.com\.br\/([^?#]+)$/i,
  );
  if (mlMatch?.[1]) {
    const path = mlMatch[1];
    // Detecta formato curto: path começa com "p/" ou "oferta/" (sem slug antes)
    if (/^(?:p|oferta)\/[A-Za-z0-9]+\/?$/i.test(path)) {
      return `https://www.magazinevoce.com.br/${input.storeSlug}/produto-${productId}/p/${productId}/in/te/`;
    }
    // Tem slug antes do /p/ — preserva
    return `https://www.magazinevoce.com.br/${input.storeSlug}/${path}`;
  }

  // Formato totalmente fora do padrão — usa placeholder determinístico
  return `https://www.magazinevoce.com.br/${input.storeSlug}/produto-${productId}/p/${productId}/in/te/`;
}

/**
 * Versão tolerante de `buildMagaluAffiliateLinkPure` — retorna `null` em vez
 * de lançar Error. Útil para a camada I/O que prefere retornar ConversionResult
 * com erro em vez de throw.
 */
export function buildMagaluAffiliateLinkPureSafe(input: BuildMagaluLinkInput): string | null {
  try {
    return buildMagaluAffiliateLinkPure(input);
  } catch {
    return null;
  }
}
