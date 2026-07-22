/**
 * Validador de ofertas em mensagens do WhatsApp.
 *
 * Analisa as últimas N mensagens de um grupo e verifica se ~70%
 * contêm links válidos de marketplaces (Shopee, Mercado Livre, Amazon),
 * inclusive resolvendo redirecionamentos de encurtadores/mascaradores de URL.
 */

import { detectMarketplace } from '@omestre/shared';
import { fetchGroupMessages } from './evolution.ts';

// ─── Configuração ──────────────────────────────────────────────────────

const VALIDATION_MESSAGE_LIMIT = 30;
const MIN_OFFER_RATIO = 0.7; // 70%

// Domínios conhecidos de encurtadores/mascaradores que redirecionam
// para marketplaces. Se cair num destes, seguimos o redirect.
const KNOWN_SHORTENER_DOMAINS = [
  /meli\.la/i,
  /amzn\.to/i,
  /shp\.ee/i,
  /s\.shopee\.com\.br/i,
  /vtao\.com/i,
  /bit\.ly/i,
  /tinyurl\.com/i,
  /shortlink\..*/i,
  /app\.mktplc\.*/i,
  /mercadoenvios\.com\.br/i,
  /go\.promozone\.ai/i,
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
}

// ─── URL extraction ────────────────────────────────────────────────────

/**
 * Extrai todas as URLs de um texto.
 * Captura http/https e também URLs sem protocolo (ex: www.exemplo.com/link)
 */
export function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;
  const matches = text.match(urlRegex);
  if (!matches) return [];

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
        const resolvedMarketplace = detectMarketplace(resolved);
        if (resolvedMarketplace !== 'unknown') return true;
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
 */
export async function validateGroup(
  instanceName: string,
  groupJid: string,
  groupName: string,
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
 * Valida múltiplos grupos de ofertas.
 * Retorna um relatório consolidado.
 */
export async function validateOfferGroups(
  instanceName: string,
  sourceGroups: { jid: string; name: string }[],
): Promise<ValidationReport> {
  const results = await Promise.all(
    sourceGroups.map((g) => validateGroup(instanceName, g.jid, g.name)),
  );

  const totalMessages = results.reduce((sum, r) => sum + r.totalMessages, 0);
  const totalValidOffers = results.reduce((sum, r) => sum + r.validOffers, 0);
  const overallRatio = totalMessages > 0 ? totalValidOffers / totalMessages : 0;

  // Overall passed: TODOS os grupos individuais passaram
  const overallPassed = results.every((r) => r.passed) && results.length > 0;

  return {
    overallPassed,
    overallRatio: Math.round(overallRatio * 100) / 100,
    totalMessages,
    totalValidOffers,
    groups: results,
  };
}
