/**
 * Revalidação periódica de grupos de ofertas.
 *
 * Verifica novamente todos os grupos fonte de todos os afiliados
 * ativos, usando a mesma lógica de validateOfferGroups().
 *
 * Se um grupo que antes passou nos 70% cair abaixo do threshold,
 * a revalidação registra o problema e notifica (via log/console).
 *
 * Uso via worker:
 *   bun apps/worker/src/index.ts --revalidate
 *   bun apps/worker/src/index.ts --revalidate-daemon
 */

import { detectMarketplace } from '@omestre/shared';
import { AffiliatesRepository } from '@omestre/db';
import { getDb } from '@omestre/db';
import { processFailure, classifyConversionError } from './notifier.ts';

// ─── Configuração ──────────────────────────────────────────────────────────

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:5444';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const REVALIDATION_INTERVAL_DAYS = parseInt(
  process.env.REVALIDATION_INTERVAL_DAYS || '7',
  10,
);

const VALIDATION_MESSAGE_LIMIT = 30;
const MIN_OFFER_RATIO = 0.7;

// Domínios conhecidos de encurtadores/mascaradores que redirecionam
// para marketplaces.
const KNOWN_SHORTENER_DOMAINS = [
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
];

// ─── Tipos ─────────────────────────────────────────────────────────────────

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

// ─── Logging ───────────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'revalidate',
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── Helpers da Evolution API ──────────────────────────────────────────────

function evolutionHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

/**
 * Busca mensagens recentes de um grupo via Evolution API.
 */
async function fetchGroupMessages(
  instanceName: string,
  groupJid: string,
  limit: number = 30,
): Promise<{
  success: boolean;
  messages?: { text?: string; timestamp?: number }[];
  error?: string;
}> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`,
      {
        method: 'POST',
        headers: evolutionHeaders(),
        body: JSON.stringify({
          jid: groupJid,
          count: limit,
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Evolution API v2 retorna a lista de mensagens de várias formas:
    let messageList: unknown[] = [];

    if (Array.isArray(data)) {
      messageList = data;
    } else if (Array.isArray(data.messages)) {
      messageList = data.messages as unknown[];
    } else if (data.messages && typeof data.messages === 'object') {
      const msgObj = data.messages as Record<string, unknown>;
      if (Array.isArray(msgObj.records)) {
        messageList = msgObj.records as unknown[];
      }
    }

    // Fallback: tenta extrair de qualquer chave que tenha array
    if (messageList.length === 0) {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          messageList = data[key] as unknown[];
          break;
        }
      }
    }

    const messages = messageList
      .map((m) => {
        const item = m as Record<string, unknown>;
        const msg = item.message as Record<string, unknown> | undefined;
        const text = String(
          item.text ??
            msg?.conversation ??
            (msg?.extendedTextMessage as Record<string, unknown> | undefined)?.text ??
            '',
        );
        return {
          text,
          timestamp: (item.timestamp as number) ?? Date.now(),
        };
      })
      .filter((m) => m.text?.trim());

    return { success: true, messages };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro desconhecido',
    };
  }
}

// ─── URL extraction & validation ──────────────────────────────────────────

/**
 * Extrai todas as URLs de um texto.
 */
function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)/gi;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  return [...new Set(matches)];
}

/**
 * Segue redirecionamentos HTTP para obter a URL final.
 */
async function resolveUrl(url: string): Promise<string> {
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
    try { await res.body?.cancel?.(); } catch {}

    return res.url || url;
  } catch {
    return url;
  }
}

/**
 * Verifica se uma mensagem contém um link de oferta válido.
 */
async function isMessageValidOffer(text: string): Promise<boolean> {
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

// ─── Validação de grupos ──────────────────────────────────────────────────

/**
 * Valida as últimas N mensagens de um grupo específico.
 * Retorna quantas são ofertas válidas e a proporção.
 */
async function validateGroup(
  instanceName: string,
  groupJid: string,
  groupName: string,
  limit: number = VALIDATION_MESSAGE_LIMIT,
): Promise<GroupValidationResult> {
  const errors: string[] = [];

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
 * Valida múltiplos grupos de ofertas para uma instância.
 * Retorna um relatório consolidado.
 */
async function validateOfferGroups(
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

// ─── Revalidação Principal ────────────────────────────────────────────────

/**
 * Executa uma rodada completa de revalidação para todos os afiliados ativos.
 *
 * Para cada afiliado:
 *   1. Busca as últimas 30 mensagens de cada grupo fonte
 *   2. Verifica a proporção de ofertas válidas (≥70%)
 *   3. Compara com o resultado anterior (se disponível)
 *   4. Se caiu abaixo de 70%, registra alerta
 *   5. Atualiza last_validated_at no banco
 *
 * Retorna um resumo da rodada.
 */
export async function runRevalidation(): Promise<{
  totalAffiliates: number;
  validatedAffiliates: number;
  failedAffiliates: number; // grupos que antes passaram e agora falharam
  results: {
    affiliateId: number;
    evolutionInstanceId: string;
    overallPassed: boolean;
    previouslyPassed: boolean | null;
    statusChanged: boolean; // passou → falhou ou falhou → passou
    groups: GroupValidationResult[];
  }[];
}> {
  log('info', 'Iniciando rodada de revalidação', {
    intervalDays: REVALIDATION_INTERVAL_DAYS,
  });

  const repo = new AffiliatesRepository();
  const affiliates = await repo.findAllActiveWithSourceGroups();

  log('info', `Encontrados ${affiliates.length} afiliados ativos com grupos`);

  const results: {
    affiliateId: number;
    evolutionInstanceId: string;
    overallPassed: boolean;
    previouslyPassed: boolean | null;
    statusChanged: boolean;
    groups: GroupValidationResult[];
  }[] = [];

  for (const affiliate of affiliates) {
    const instanceName = affiliate.evolutionInstanceId;
    const sourceGroups = (affiliate.sourceGroups ?? []) as { jid: string; name: string }[];

    if (!instanceName || sourceGroups.length === 0) continue;

    log('info', `Validando afiliado ${affiliate.id} (${instanceName})`, {
      groups: sourceGroups.map((g) => g.name),
    });

    const validation = await validateOfferGroups(instanceName, sourceGroups);

    // Verifica mudança de status
    const previouslyPassed = affiliate.lastValidationPassed;
    const statusChanged =
      previouslyPassed !== null && previouslyPassed !== validation.overallPassed;

    if (statusChanged && !validation.overallPassed) {
      // ⚠️ Grupo que ANTES passava e AGORA falhou
      log('warn', `Afiliado ${affiliate.id} ANTES passava na validação e AGORA FALHOU!`, {
        instanceName,
        previouslyPassed,
        currentPassed: validation.overallPassed,
        overallRatio: validation.overallRatio,
        groups: validation.groups.map((g) => ({
          name: g.groupName,
          ratio: g.ratio,
          passed: g.passed,
          errors: g.errors,
        })),
      });

      // Notifica se houver erros de validação com causa identificável
      for (const g of validation.groups) {
        for (const err of g.errors) {
          const failureType = classifyConversionError('mercadolivre', err)
            ?? classifyConversionError('shopee', err);
          if (failureType) {
            processFailure(instanceName!, failureType, { marketplace: 'unknown' }).catch(() => {});
          }
        }
      }
    } else if (!validation.overallPassed) {
      log('warn', `Afiliado ${affiliate.id} falhou na validação`, {
        instanceName,
        overallRatio: validation.overallRatio,
        groups: validation.groups
          .filter((g) => !g.passed)
          .map((g) => ({
            name: g.groupName,
            ratio: g.ratio,
            errors: g.errors,
          })),
      });
    } else {
      log('info', `Afiliado ${affiliate.id} passou na validação`, {
        instanceName,
        overallRatio: validation.overallRatio,
      });
    }

    // Persiste o resultado no banco
    try {
      await repo.updateValidation(affiliate.id, {
        lastValidatedAt: new Date(),
        lastValidationPassed: validation.overallPassed,
        lastValidationReport: {
          overallRatio: validation.overallRatio,
          totalMessages: validation.totalMessages,
          totalValidOffers: validation.totalValidOffers,
          groups: validation.groups.map((g) => ({
            groupJid: g.groupJid,
            groupName: g.groupName,
            totalMessages: g.totalMessages,
            validOffers: g.validOffers,
            ratio: g.ratio,
            passed: g.passed,
          })),
        },
      });
    } catch (err) {
      log('error', `Erro ao salvar resultado da revalidação para afiliado ${affiliate.id}`, {
        error: String(err),
      });
    }

    results.push({
      affiliateId: affiliate.id,
      evolutionInstanceId: instanceName,
      overallPassed: validation.overallPassed,
      previouslyPassed,
      statusChanged,
      groups: validation.groups,
    });
  }

  const failedAffiliates = results.filter(
    (r) => r.statusChanged && !r.overallPassed,
  ).length;
  const validatedAffiliates = results.length;

  log('info', 'Rodada de revalidação concluída', {
    totalAffiliates: affiliates.length,
    validatedAffiliates,
    failedAffiliates,
  });

  return {
    totalAffiliates: affiliates.length,
    validatedAffiliates,
    failedAffiliates,
    results,
  };
}

/**
 * Modo daemon: executa a revalidação em loop com intervalo configurável.
 */
export async function runRevalidationDaemon(): Promise<void> {
  const POLL_INTERVAL_MS = REVALIDATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000;

  log('info', 'Revalidation daemon iniciado', {
    intervalMs: POLL_INTERVAL_MS,
    intervalDays: REVALIDATION_INTERVAL_DAYS,
  });

  // Execute immediately on start
  await runRevalidation();

  // Then repeat at the configured interval
  const interval = setInterval(async () => {
    try {
      await runRevalidation();
    } catch (err) {
      log('error', 'Erro na rodada de revalidação agendada', {
        error: String(err),
      });
    }
  }, POLL_INTERVAL_MS);

  // Graceful shutdown
  const shutdown = () => {
    log('info', 'Revalidation daemon desligando...');
    clearInterval(interval);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
