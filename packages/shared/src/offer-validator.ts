/**
 * Validador de ofertas em mensagens do WhatsApp.
 *
 * Analisa as últimas N mensagens de um grupo e verifica se ~70%
 * contêm links válidos de marketplaces (Shopee, Mercado Livre, Amazon),
 * inclusive resolvendo redirecionamentos de encurtadores/mascaradores de URL.
 *
 * Uso compartilhado entre API e Worker.
 * Cada app injeta sua própria implementação de fetchGroupMessages,
 * já que API e Worker acessam a Evolution API com URLs/chaves diferentes.
 */

import { detectMarketplace, type Marketplace } from './index.ts';

// ─── Configuração ──────────────────────────────────────────────────────

export const VALIDATION_MESSAGE_LIMIT = 30;
export const MIN_OFFER_RATIO = 0.3; // 30%

// Domínios conhecidos de encurtadores/mascaradores que redirecionam
// para marketplaces. Se cair num destes, seguimos o redirect.
export const KNOWN_SHORTENER_DOMAINS = [
  /meli\.la/i,
  /amzn\.to/i,
  /shp\.ee/i,
  /s\.shopee\.com\.br/i,
  /vtao\.com/i,
  /bit\.ly/i,
  /tinyurl\.com/i,
  /shortlink\..*/i,
  /app\.mktplc\..*/i,
  /mercadoenvios\.com\.br/i,
  /go\.promozone\.ai/i,
  /maga\.lu/i,
];

// ─── Tipos ─────────────────────────────────────────────────────────────

export interface GroupValidationResult {
  groupJid: string;
  groupName: string;
  totalMessages: number;
  validOffers: number;
  invalidMessages: number;
  ratio: number;
  passed: boolean;
  errors: string[];
}

export interface ValidationReport {
  overallPassed: boolean;
  overallRatio: number;
  totalMessages: number;
  totalValidOffers: number;
  groups: GroupValidationResult[];
  /** Quando presente, indica que a validação falhou por erro de conexão
   * com a Evolution API (não por baixa taxa de ofertas). */
  connectionError?: string;
}

// ─── Types para injeção de dependência ─────────────────────────────────

export interface FetchMessagesResult {
  success: boolean;
  messages?: { text?: string; timestamp?: number }[];
  error?: string;
}

export type FetchMessagesFn = (
  instanceName: string,
  groupJid: string,
  limit: number,
) => Promise<FetchMessagesResult>;

// ─── URL extraction ────────────────────────────────────────────────────

/** Domínios conhecidos que também são capturados em formato sem protocolo */
const PROTOCOL_LESS_DOMAIN_PATTERNS = [
  /go\.promozone\.ai/i,
  /meli\.la/i,
  /amzn\.to/i,
  /shp\.ee/i,
  /s\.shopee\.com\.br/i,
  /vtao\.com/i,
  /bit\.ly/i,
  /tinyurl\.com/i,
  /shopee\.com\.br/i,
  /mercadolivre\.com\.br/i,
  /amazon\.com\.br/i,
  /mercadoenvios\.com\.br/i,
];

/**
 * Extrai todas as URLs de um texto.
 * Captura http/https e também URLs sem protocolo (ex: www.exemplo.com/link)
 */
export function extractUrls(text: string): string[] {
  // Regex 1: URLs completas com protocolo http/https
  const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;
  const matches: string[] = text.match(urlRegex) ?? [];

  // Regex 2: URLs sem protocolo (ex: go.promozone.ai/mercadolivre/YhHbav)
  // Só captura se o domínio estiver na lista de conhecidos (evita falsos positivos)
  const noProtocolRegex = /(?<!\w)(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\/[-a-zA-Z0-9()@:%_+.~#?&/=]+/gi;
  const protocolLessMatches: string[] = text.match(noProtocolRegex) ?? [];

  for (const raw of protocolLessMatches) {
    // Verifica se o domínio é conhecido antes de adicionar
    if (PROTOCOL_LESS_DOMAIN_PATTERNS.some((p) => p.test(raw))) {
      // Só adiciona se não houver versão http ou https já capturada
      // (evita duplicatas como http://meli.la/x + https://meli.la/x)
      const withHttp = `http://${raw}`;
      const withHttps = `https://${raw}`;
      if (!matches.includes(withHttp) && !matches.includes(withHttps)) {
        matches.push(withHttps);
      }
    }
  }

  // Deduplica mantendo ordem
  return [...new Set(matches)];
}

/**
 * Verifica se uma URL é de um domínio de marketplace conhecido
 * ou de um encurtador que costuma redirecionar para marketplaces.
 */
export function isKnownMarketplaceDomain(url: string): boolean {
  const marketplace = detectMarketplace(url);
  if (marketplace !== 'unknown') return true;

  // Verifica domínios de encurtadores conhecidos
  return KNOWN_SHORTENER_DOMAINS.some((pattern) => pattern.test(url));
}

/**
 * Segue redirecionamentos HTTP para obter a URL final.
 * Útil para encurtadores (meli.la, amzn.to, shp.ee, etc.).
 * Timeout de 5 segundos para evitar travamentos.
 */
export async function resolveUrl(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    clearTimeout(timeout);

    // Cancela o body pra não baixar a página inteira — só queremos a URL final
    try { await res.body?.cancel?.(); } catch {}

    return res.url || url;
  } catch {
    // Se falhar (timeout, rede), retorna a URL original
    return url;
  }
}

/**
 * Detecta marketplace pela análise do PATH da URL.
 * Útil para redirectors JS (go.promozone.ai) onde HTTP redirect
 * não pode ser seguido, mas o path da URL já indica o marketplace.
 */
export function detectMarketplaceByPath(url: string): Marketplace {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    if (/\/shopee\b|\/shp\b/i.test(pathname)) return 'shopee';
    if (/\/mercadolivre\b|\/mercadolibre\b|\/ml\b/i.test(pathname)) return 'mercadolivre';
    if (/\/amazon\b|\/amzn\b|\/amz\b/i.test(pathname)) return 'amazon';
  } catch {
    // URL inválida, ignora
  }
  return 'unknown';
}

/**
 * Verifica se uma mensagem contém um link de oferta válido.
 * Isso inclui URLs diretas de marketplace e URLs encurtadas
 * que redirecionam para marketplaces.
 */
export async function isMessageValidOffer(text: string): Promise<boolean> {
  const urls = extractUrls(text);
  if (urls.length === 0) return false;

  for (const url of urls) {
    // Passo 1: Verificação rápida por domínio
    const marketplace = detectMarketplace(url);
    if (marketplace !== 'unknown') return true;

    // Passo 2: Se for encurtador conhecido, segue o redirect
    if (KNOWN_SHORTENER_DOMAINS.some((p) => p.test(url))) {
      const resolved = await resolveUrl(url);
      if (resolved !== url) {
        // HTTP redirect funcionou — verifica o destino
        const resolvedMarketplace = detectMarketplace(resolved);
        if (resolvedMarketplace !== 'unknown') return true;
      } else {
        // JS redirect (go.promozone.ai, etc) — detecta marketplace pelo path da URL
        const pathMarketplace = detectMarketplaceByPath(url);
        if (pathMarketplace !== 'unknown') return true;
      }
    }

    // Passo 3: Para URLs desconhecidas, tenta seguir redirect
    // (pode ser um mascarador de URL não listado)
    if (!url.startsWith('http')) continue;
    try {
      const resolved = await resolveUrl(url);
      if (resolved !== url) {
        const resolvedMarketplace = detectMarketplace(resolved);
        if (resolvedMarketplace !== 'unknown') return true;
      }
    } catch {
      // Ignora falhas de resolução
    }
  }

  return false;
}

// ─── Validação de grupos ───────────────────────────────────────────────

/**
 * Valida as últimas N mensagens de um grupo específico.
 * Retorna quantas são ofertas válidas e a proporção.
 *
 * @param fetchGroupMessages - Função injetada para buscar mensagens da Evolution API
 *                             (cada app tem sua própria implementação)
 */
export async function validateGroup(
  instanceName: string,
  groupJid: string,
  groupName: string,
  fetchGroupMessages: FetchMessagesFn,
  limit: number = VALIDATION_MESSAGE_LIMIT,
): Promise<GroupValidationResult> {
  const errors: string[] = [];

  // Busca mensagens do grupo via Evolution API
  const result = await fetchGroupMessages(instanceName, groupJid, limit);

  if (!result.success) {
    return {
      groupJid,
      groupName,
      totalMessages: 0,
      validOffers: 0,
      invalidMessages: 0,
      ratio: 0,
      passed: false,
      errors: [result.error || 'Erro ao buscar mensagens do grupo'],
    };
  }

  const messages = result.messages ?? [];

  if (messages.length === 0) {
    return {
      groupJid,
      groupName,
      totalMessages: 0,
      validOffers: 0,
      invalidMessages: 0,
      ratio: 0,
      passed: false,
      errors: ['Nenhuma mensagem encontrada nos últimos registros do grupo'],
    };
  }

  // Verifica cada mensagem em paralelo (com limite de concorrência)
  const concurrencyLimit = 5;
  let validCount = 0;

  for (let i = 0; i < messages.length; i += concurrencyLimit) {
    const batch = messages.slice(i, i + concurrencyLimit);
    const results = await Promise.all(
      batch.map((msg) => isMessageValidOffer(msg.text ?? '')),
    );
    validCount += results.filter(Boolean).length;
  }

  const totalMessages = messages.length;
  const ratio = totalMessages > 0 ? validCount / totalMessages : 0;
  const passed = ratio >= MIN_OFFER_RATIO;

  return {
    groupJid,
    groupName,
    totalMessages,
    validOffers: validCount,
    invalidMessages: totalMessages - validCount,
    ratio: Math.round(ratio * 100) / 100,
    passed,
    errors,
  };
}

/**
 * Detecta se todos os grupos falharam por erro de conexão com a Evolution API.
 * Quando offline, todos os grupos recebem erros como "fetch failed",
 * "connect ECONNREFUSED", "Evolution API retornou HTTP ...", etc.
 * Retorna o erro mais específico encontrado, ou undefined se ao menos um
 * grupo falhou por motivo de conteúdo (ratio baixo).
 */
export function detectConnectionError(results: GroupValidationResult[]): string | undefined {
  if (results.length === 0) return undefined;

  // Se algum grupo passou, não é erro de conexão
  if (results.some((r) => r.passed)) return undefined;

  // Palavras-chave que indicam erro de conexão com Evolution API
  const CONNECTION_KEYWORDS = [
    'evolution api',
    'connect',
    'econnrefused',
    'fetch failed',
    'unable to connect',
    'enotfound',
    'etimedout',
    'econnreset',
    'erro ao buscar mensagens',
  ];

  const allConnectionErrors = results.every((r) => {
    if (r.errors.length === 0) return false;
    const firstError = r.errors[0]!.toLowerCase();
    return CONNECTION_KEYWORDS.some((kw) => firstError.includes(kw));
  });

  if (!allConnectionErrors) return undefined;

  // Pega o erro mais específico (evita os genéricos se houver um mais descritivo)
  const genericPhrases = ['erro ao buscar mensagens do grupo', 'erro ao buscar mensagens'];
  const specific = results
    .map((r) => r.errors[0]!)
    .find((e) => !genericPhrases.some((g) => e.toLowerCase().includes(g)));

  return specific || results[0]!.errors[0]!;
}

/**
 * Valida múltiplos grupos de ofertas.
 * Retorna um relatório consolidado.
 *
 * @param fetchGroupMessages - Função injetada para buscar mensagens da Evolution API
 */
export async function validateOfferGroups(
  instanceName: string,
  sourceGroups: { jid: string; name: string }[],
  fetchGroupMessages: FetchMessagesFn,
): Promise<ValidationReport> {
  const results = await Promise.all(
    sourceGroups.map((g) => validateGroup(instanceName, g.jid, g.name, fetchGroupMessages)),
  );

  const totalMessages = results.reduce((sum, r) => sum + r.totalMessages, 0);
  const totalValidOffers = results.reduce((sum, r) => sum + r.validOffers, 0);
  const overallRatio = totalMessages > 0 ? totalValidOffers / totalMessages : 0;

  // Overall passed: TODOS os grupos individuais passaram
  const overallPassed = results.every((r) => r.passed) && results.length > 0;

  // Detecta se a Evolution API está offline
  const connectionError = detectConnectionError(results);

  return {
    overallPassed,
    overallRatio: Math.round(overallRatio * 100) / 100,
    totalMessages,
    totalValidOffers,
    groups: results,
    connectionError,
  };
}
