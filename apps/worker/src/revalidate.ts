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

import type { GroupValidationResult } from '@omestre/shared';
import { validateOfferGroups } from '@omestre/shared';
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

    // Evolution API v2 ignora o filtro jid — filtra manualmente por remoteJid
    messageList = messageList.filter((m) => {
      const item = m as Record<string, unknown>;
      const key = item.key as Record<string, unknown> | undefined;
      return key?.remoteJid === groupJid;
    });

    const messages = messageList
      .map((m) => {
        const item = m as Record<string, unknown>;
        const msg = item.message as Record<string, unknown> | undefined;

        // Extrai caption de mídia NÃO efêmera (imageMessage/videoMessage/documentMessage)
        function extractMediaCaption(m: Record<string, unknown> | undefined): string | undefined {
          if (!m) return undefined;
          const imgMsg = m.imageMessage as Record<string, unknown> | undefined;
          if (imgMsg?.caption) return String(imgMsg.caption);
          const vidMsg = m.videoMessage as Record<string, unknown> | undefined;
          if (vidMsg?.caption) return String(vidMsg.caption);
          const docMsg = m.documentMessage as Record<string, unknown> | undefined;
          if (docMsg?.caption) return String(docMsg.caption);
          return undefined;
        }

        // Extrai caption de mensagens efêmeras (ephemeralMessage)
        function extractEphemeralCaption(m: Record<string, unknown> | undefined): string | undefined {
          if (!m) return undefined;
          const ephemeral = m.ephemeralMessage as Record<string, unknown> | undefined;
          if (!ephemeral) return undefined;
          const innerMsg = ephemeral.message as Record<string, unknown> | undefined;
          if (!innerMsg) return undefined;
          const imgMsg = innerMsg.imageMessage as Record<string, unknown> | undefined;
          if (imgMsg?.caption) return String(imgMsg.caption);
          const vidMsg = innerMsg.videoMessage as Record<string, unknown> | undefined;
          if (vidMsg?.caption) return String(vidMsg.caption);
          const docMsg = innerMsg.documentMessage as Record<string, unknown> | undefined;
          if (docMsg?.caption) return String(docMsg.caption);
          if (innerMsg.conversation) return String(innerMsg.conversation);
          const extMsg = innerMsg.extendedTextMessage as Record<string, unknown> | undefined;
          if (extMsg?.text) return String(extMsg.text);
          return undefined;
        }

        const text = String(
          item.text ??
            msg?.conversation ??
            (msg?.extendedTextMessage as Record<string, unknown> | undefined)?.text ??
            extractMediaCaption(msg) ??
            extractEphemeralCaption(msg) ??
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

    const validation = await validateOfferGroups(instanceName, sourceGroups, fetchGroupMessages);

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
