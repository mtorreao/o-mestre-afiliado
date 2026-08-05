/**
 * Lógica PURA da geração de links curtos ML (meli.la).
 *
 * Separa a extração de CSRF do HTML, a montagem do body do POST
 * createLink, o parsing/classificação da resposta (meli.la/xxx) e a
 * formatação de erros HTTP da camada de I/O (fetch). Todas as funções
 * aqui são síncronas, não dependem de rede e são 100% testáveis.
 *
 * O I/O (fetch + cookies de sessão) fica em `ml-linkbuilder.ts`, que
 * consome este módulo.
 */

// ─── Constantes compartilhadas (I/O as importa) ────────────────────────

/** URL da página do Link Builder (GET para CSRF + POST para createLink). */
export const ML_LINK_BUILDER_URL = 'https://www.mercadolivre.com.br/afiliados/linkbuilder';

/** Endpoint interno da API createLink. */
export const ML_CREATE_LINK_API =
  'https://www.mercadolivre.com.br/affiliate-program/api/v2/affiliates/createLink';

/** User-Agent usado nas requisições ao Link Builder. */
export const META_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/**
 * Monta os headers do GET na página do Link Builder (obtenção do CSRF).
 * Função pura: só formata strings a partir dos cookies.
 */
export function buildLinkBuilderPageHeaders(cookies: string): Record<string, string> {
  return {
    Cookie: cookies,
    'User-Agent': META_UA,
  };
}

/**
 * Monta os headers do POST no endpoint createLink.
 * `csrfToken` vem do <meta> da página; `userAgent` é injetável para teste.
 * Função pura: só formata strings.
 */
export function buildCreateLinkApiHeaders(
  cookies: string,
  csrfToken: string,
  userAgent: string = META_UA,
): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-csrf-token': csrfToken,
    Cookie: cookies,
    'User-Agent': userAgent,
    Referer: ML_LINK_BUILDER_URL,
    Origin: 'https://www.mercadolivre.com.br',
  };
}

/** Formata a mensagem de erro quando o fetch do CSRF lança exceção. */
export function formatCsrfRetrievalError(err: unknown): string {
  return `Erro ao obter CSRF token: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Regex para extrair o CSRF token do <meta name="csrf-token">.
 * Tolerante à ordem dos atributos (name antes/depois de content) e a
 * aspas simples ou duplas — mantém a flag `i` para o nome do atributo.
 */
export const CSRF_TOKEN_REGEX =
  /<meta\s+(?:name=["']csrf-token["']\s+content=["']([^"']+)["']|content=["']([^"']+)["']\s+name=["']csrf-token["'])/i;

/** Mensagem de erro quando o CSRF token não é encontrado na página. */
export const CSRF_NOT_FOUND_MESSAGE =
  'CSRF token não encontrado na página. Cookies podem estar expirados.';

/** Mensagem de erro quando a API retorna sem URLs. */
export const EMPTY_URLS_MESSAGE = 'API retornou sem URLs';

/** Mensagem de erro quando a API não retorna short_url. */
export const MISSING_SHORT_URL_MESSAGE =
  'API não retornou short_url. Produto pode não ser elegível.';

// ─── Classificação de erros (mapa error_code da API) ────────────────────

/**
 * Classificação de erro do Link Builder — usada por chamadores para decidir
 * fallback (cookie_expired/network → URL params) vs. erro acionável
 * (tag_mismatch/product_not_eligible → retornar ao usuário).
 *
 * Mapa oficial (docs/plans/melhorias-ml.md itens 8 e 9):
 *  - 109: tag não associada ao afiliado → reimportar cookies da conta correta
 *  - 111: "URL not allowed in affiliates program" → produto não elegível
 *  - 401: não autorizado → cookies expirados
 */
export type MlShortLinkErrorKind =
  'cookie_expired' | 'tag_mismatch' | 'product_not_eligible' | 'network' | 'unknown';

/** error_code 109 — tag não associada ao afiliado. */
export const ML_ERROR_TAG_NOT_ASSOCIATED = 109;
/** error_code 111 — "URL not allowed in affiliates program" (produto não elegível). */
export const ML_ERROR_URL_NOT_ALLOWED = 111;
/** error_code 401 — não autorizado (cookies expirados). */
export const ML_ERROR_UNAUTHORIZED = 401;

/** Mensagem acionável para tag não associada ao afiliado. */
export const ML_TAG_MISMATCH_MESSAGE =
  'Tag não associada ao afiliado. Reimporte os cookies da conta correta no painel do Mercado Livre.';

/** Mensagem acionável para produto não elegível no programa de afiliados. */
export const ML_PRODUCT_NOT_ELIGIBLE_MESSAGE =
  'Produto não elegível no programa de afiliados do Mercado Livre. Não é possível gerar link de afiliado para esta URL.';

/** Mensagem acionável para cookies de sessão expirados. */
export const ML_COOKIE_EXPIRED_MESSAGE =
  'Cookies de sessão expirados. Reimporte os cookies do Mercado Livre no painel.';

/** Marcadores de mensagem (PT/ES/EN, lowercase) por classificação. */
const COOKIE_ERROR_MARKERS = [
  'http 40',
  'cookies podem estar expirados',
  'unauthorized',
  'não autorizado',
  'nao autorizado',
];
const NETWORK_ERROR_MARKERS = [
  'erro ao obter csrf',
  'fetch failed',
  'failed to fetch',
  'networkerror',
  'econnrefused',
];

function messageHasAnyMarker(message: string, markers: string[]): boolean {
  const m = message.toLowerCase();
  return markers.some((marker) => m.includes(marker));
}

/** Detecta erro de tag: presença de "tag" + termo de associação/invalidação. */
function isTagError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('tag') &&
    messageHasAnyMarker(m, [
      'associad',
      'asociad',
      'inválid',
      'invalid',
      'no es válid',
      'no es valid',
      'não existe',
      'nao existe',
      'no existe',
    ])
  );
}

/** Detecta URL não permitida / produto não elegível (PT/ES/EN). */
function isProductEligibilityError(message: string): boolean {
  const m = message.toLowerCase();
  const urlNotAllowed =
    m.includes('url') &&
    messageHasAnyMarker(m, ['no permitid', 'não permitid', 'nao permitid', 'not allowed']);
  // Co-ocorrência de termo de elegibilidade + negação (PT/ES/EN), tolerante
  // a variações tipo "no es elegible"/"não é elegível".
  const hasEligibilityTerm = messageHasAnyMarker(m, [
    'elegível',
    'elegivel',
    'elegible',
    'eligible',
  ]);
  const notEligible = hasEligibilityTerm && messageHasAnyMarker(m, ['não', 'nao', ' no ', 'not']);
  return urlNotAllowed || notEligible;
}

/**
 * Classifica uma mensagem de erro do Link Builder em `MlShortLinkErrorKind`.
 * `status` (HTTP) tem precedência: 401/403 são sempre cookies expirados.
 * Função pura — usada na camada de I/O e no parse da resposta.
 */
export function classifyMlShortLinkError(message: string, status?: number): MlShortLinkErrorKind {
  if (status !== undefined && (status === 401 || status === 403)) {
    return 'cookie_expired';
  }
  if (messageHasAnyMarker(message, COOKIE_ERROR_MARKERS)) return 'cookie_expired';
  if (isTagError(message)) return 'tag_mismatch';
  if (isProductEligibilityError(message)) return 'product_not_eligible';
  if (messageHasAnyMarker(message, NETWORK_ERROR_MARKERS)) return 'network';
  return 'unknown';
}

/**
 * Mapeia `error_code` + mensagem da API createLink em erro acionável.
 * Prioridade: código conhecido (109/111/401) → marcadores na mensagem →
 * mantém a mensagem original como `unknown`.
 */
export function formatCreateLinkError(
  errorCode: number | undefined,
  message: string | undefined,
): { message: string; kind: MlShortLinkErrorKind } {
  const kind = classifyMlShortLinkError(message ?? '');
  const suffix = errorCode !== undefined ? ` (código ${errorCode})` : '';

  if (errorCode === ML_ERROR_TAG_NOT_ASSOCIATED || kind === 'tag_mismatch') {
    return { message: `${ML_TAG_MISMATCH_MESSAGE}${suffix}`, kind: 'tag_mismatch' };
  }
  if (errorCode === ML_ERROR_URL_NOT_ALLOWED || kind === 'product_not_eligible') {
    return {
      message: `${ML_PRODUCT_NOT_ELIGIBLE_MESSAGE}${suffix}`,
      kind: 'product_not_eligible',
    };
  }
  if (errorCode === ML_ERROR_UNAUTHORIZED || kind === 'cookie_expired') {
    return { message: `${ML_COOKIE_EXPIRED_MESSAGE}${suffix}`, kind: 'cookie_expired' };
  }
  return {
    message: message ?? `Erro do Link Builder: código ${errorCode ?? 'desconhecido'}`,
    kind: 'unknown',
  };
}

// ─── Interfaces compartilhadas ─────────────────────────────────────────

export interface CreateLinkRequest {
  urls: string[];
  tag: string;
}

export interface CreateLinkResponse {
  status: number;
  urls?: Array<{
    id?: string;
    short_url?: string;
    long_url?: string;
    tag?: string;
    type_url?: string;
    message?: string;
    error_code?: number;
    status?: number;
  }>;
  total_items?: number;
  total_success?: number;
  total_error?: number;
}

export interface ShortLinkResult {
  success: boolean;
  shortUrl?: string;
  longUrl?: string;
  error?: string;
  /**
   * Classificação do erro (mapa error_code da API) — permite que chamadores
   * decidam fallback (cookie_expired/network) vs. erro acionável
   * (tag_mismatch/product_not_eligible) sem depender do texto da mensagem.
   */
  errorKind?: MlShortLinkErrorKind;
  /**
   * Cookies renovados durante a chamada (401/403 → renovação via set-cookie).
   * Preenchido quando a sessão foi renovada com sucesso — o chamador pode
   * persistir para evitar uma nova renovação na próxima conversão.
   */
  renewedCookies?: string;
}

// ─── Extração de CSRF ───────────────────────────────────────────────────

/**
 * Extrai o CSRF token do HTML da página do Link Builder.
 * Retorna null se o <meta> não estiver presente (ex.: cookies expirados).
 */
export function extractCsrfToken(html: string): string | null {
  const match = html.match(CSRF_TOKEN_REGEX);
  // O regex tem dois grupos de captura (content antes ou depois de name);
  // o token está em um dos dois, independente da ordem dos atributos.
  return match?.[1] ?? match?.[2] ?? null;
}

// ─── Montagem do body do POST ───────────────────────────────────────────

/** Monta o body do POST /affiliate-program/api/v2/affiliates/createLink. */
export function buildCreateLinkBody(productUrl: string, tag: string): CreateLinkRequest {
  return {
    urls: [productUrl],
    tag,
  };
}

// ─── Classificação de erros HTTP ─────────────────────────────────────────

/**
 * Formata a mensagem de erro para respostas HTTP não-ok do Link Builder.
 * `scope` distingue o acesso à página (GET) da chamada da API (POST).
 */
export function formatLinkBuilderHttpError(scope: 'page' | 'api', status: number): string {
  return scope === 'page'
    ? `Falha ao acessar Link Builder: HTTP ${status}`
    : `API do Link Builder retornou HTTP ${status}`;
}

// ─── Renovação de sessão / cache de CSRF ───────────────────────────────

/** Status HTTP que indicam cookies de sessão expirados no Link Builder. */
export function isSessionExpiredStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Fingerprint FNV-1a 32-bit dos cookies (puro, sem node:crypto).
 * Usado como parte da chave do cache de CSRF: enquanto os cookies não
 * mudarem, o token cacheado continua válido; ao reimportar cookies, o
 * fingerprint muda e o cache é naturalmente invalidado.
 */
export function fingerprintCookies(cookies: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < cookies.length; i++) {
    hash ^= cookies.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Chave do cache de CSRF: etiqueta do afiliado + fingerprint dos cookies. */
export function buildCsrfCacheKey(tag: string, cookies: string): string {
  return `${tag}|${fingerprintCookies(cookies)}`;
}

/**
 * Formata o erro quando a renovação de cookies falha após 401/403 no
 * createLink. A mensagem mantém os marcadores de erro de cookie
 * ('HTTP 40' / 'Cookies podem estar expirados') para que os chamadores
 * caiam no fallback de URL params e o pipeline classifique como
 * cookie_error.
 */
export function formatRenewalFailedError(status: number): string {
  return `Não foi possível renovar os cookies de sessão (HTTP ${status}). Cookies podem estar expirados.`;
}

// ─── Parsing da resposta ─────────────────────────────────────────────────

/**
 * Converte a resposta crua do createLink em ShortLinkResult.
 *
 * Cobre todos os branchs de validação:
 *  - sem URLs → erro EMPTY_URLS_MESSAGE
 *  - erro interno (error_code) → mapeado em mensagem acionável + errorKind
 *    (109 tag, 111 URL não permitida, 401 cookies; fallback por marcadores)
 *  - ausência de short_url → erro MISSING_SHORT_URL_MESSAGE
 *  - sucesso → shortUrl + longUrl
 */
export function parseCreateLinkResponse(data: CreateLinkResponse): ShortLinkResult {
  if (!data.urls || data.urls.length === 0) {
    return { success: false, error: EMPTY_URLS_MESSAGE, errorKind: 'unknown' };
  }

  const result = data.urls[0]!;

  // Erro interno — mapeia error_code em mensagem acionável (spec itens 8/9)
  if (result.error_code) {
    const mapped = formatCreateLinkError(result.error_code, result.message);
    return { success: false, error: mapped.message, errorKind: mapped.kind };
  }

  if (!result.short_url) {
    return { success: false, error: MISSING_SHORT_URL_MESSAGE, errorKind: 'unknown' };
  }

  return {
    success: true,
    shortUrl: result.short_url,
    longUrl: result.long_url,
  };
}
