/**
 * Mirror Pipeline — Processa mensagens de grupos de espelhamento.
 *
 * Fluxo:
 *   1. Recebe MirrorMessageEvent do Redis PubSub
 *   2. Extrai links de marketplace e detecta URLs
 *   3. Converte para link de afiliado
 *   4. Monta template da mensagem
 *   5. Envia para o grupo de destino via Evolution API
 *   6. Registra em reflected_offers
 */

import type { MirrorMessageEvent } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';
import { convertShopeeUrlWithCredentials, generateViaUrlParams, generateShortAffiliateLink } from '@omestre/converters';
import { getDb, affiliates, reflectedOffers, UserCredentialsRepository, MlAffiliateRepository, AffiliatesRepository } from '@omestre/db';
import { eq, and, gte } from 'drizzle-orm';

// ─── Config ──────────────────────────────────────────────────────────

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:5444';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

// ─── Logging ─────────────────────────────────────────────────────────

function log(level: 'info' | 'warn' | 'error', message: string, data?: unknown) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'mirror-worker',
    message,
    ...(data ? { data } : {}),
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function evolutionHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

/**
 * Extrai URLs que parecem ser de marketplace de um texto.
 * Retorna a primeira URL de marketplace encontrada.
 */
function extractMarketplaceUrl(text: string): string | null {
  // Regex para capturar URLs
  const urlRegex = /https?:\/\/[^\s<>"']+/gi;
  const urls = text.match(urlRegex);
  if (!urls) return null;

  // Retorna a primeira URL de marketplace válida
  for (const url of urls) {
    const marketplace = detectMarketplace(url);
    if (marketplace !== 'unknown') {
      return url;
    }
  }
  return null;
}

/**
 * Envia mensagem de texto para um grupo via Evolution API.
 */
async function sendToGroup(
  instanceName: string,
  groupJid: string,
  text: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/message/sendText/${instanceName}`,
      {
        method: 'POST',
        headers: evolutionHeaders(),
        body: JSON.stringify({
          number: groupJid,
          text,
          delay: 2000,
          linkPreview: true,
        }),
      },
    );

    if (!res.ok) {
      const body = await res.text();
      log('error', 'Falha ao enviar mensagem', {
        instanceName,
        groupJid,
        status: res.status,
        body,
      });
      return false;
    }

    return true;
  } catch (err) {
    log('error', 'Erro ao enviar mensagem', {
      instanceName,
      groupJid,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Verifica se já processamos esta URL para este afiliado dentro da janela de dedup.
 */
async function isDuplicate(
  affiliateId: number,
  originalUrl: string,
  dedupHours: number = 24,
): Promise<boolean> {
  try {
    const db = getDb();
    const cutoff = new Date(Date.now() - dedupHours * 60 * 60 * 1000);

    const existing = await db
      .select({ id: reflectedOffers.id })
      .from(reflectedOffers)
      .where(
        and(
          eq(reflectedOffers.affiliateId, affiliateId),
          eq(reflectedOffers.originalLink, originalUrl),
          gte(reflectedOffers.reflectedAt, cutoff),
        ),
      )
      .limit(1);

    return existing.length > 0;
  } catch (err) {
    log('warn', 'Erro ao verificar dedup', {
      affiliateId,
      originalUrl,
      error: err instanceof Error ? err.message : String(err),
    });
    return false; // Em caso de erro, processa mesmo assim
  }
}

/**
 * Busca os targetGroups de um afiliado.
 */
async function getTargetGroups(
  affiliateId: number,
): Promise<{ jid: string; name: string }[]> {
  try {
    const db = getDb();
    const rows = await db
      .select({ targetGroups: affiliates.targetGroups })
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId))
      .limit(1);

    if (!rows[0]) return [];
    return (rows[0].targetGroups as { jid: string; name: string }[]) ?? [];
  } catch (err) {
    log('error', 'Erro ao buscar targetGroups', { affiliateId, error: String(err) });
    return [];
  }
}

/**
 * Busca as configurações de filtro do afiliado.
 */
async function getFilters(
  affiliateId: number,
): Promise<{ blacklist: string[]; keywords: string[]; dedupHours: number } | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ filters: affiliates.filters })
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId))
      .limit(1);

    if (!rows[0]) return null;
    return (rows[0].filters as { blacklist: string[]; keywords: string[]; dedupHours: number }) ?? null;
  } catch {
    return null;
  }
}

/**
 * Converte o link de acordo com o marketplace usando as credenciais
 * específicas do afiliado (Shopee App ID/Secret, ML melitat/tokens).
 *
 * Fluxo de descoberta das credenciais:
 *   1. Busca o affiliate no banco pelo ID → obtém evolutionInstanceId ("user-{userId}")
 *   2. Extrai o userId do instanceName
 *   3. Busca UserCredentials para Shopee
 *   4. Busca MlAffiliates (via findByPlatformUserId) para ML
 *   5. Usa a função de conversão apropriada com as credenciais encontradas
 */
async function convertOfferUrl(
  originalUrl: string,
  affiliateId: number,
  instanceName: string,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
}> {
  const marketplace = detectMarketplace(originalUrl);

  if (marketplace === 'unknown') {
    return { convertedUrl: null, marketplace, success: false };
  }

  try {
    // Extrai userId do instanceName (formato "user-{userId}")
    const userIdMatch = instanceName.match(/^user-(\d+)$/);
    if (!userIdMatch) {
      log('warn', 'InstanceName não está no formato user-{userId}', { instanceName });
      // Fallback: tenta conversão global
      const { convertUrl } = await import('@omestre/converters');
      const result = await convertUrl(originalUrl);
      return {
        convertedUrl: result.affiliateUrl,
        marketplace,
        success: result.success,
      };
    }

    const userId = parseInt(userIdMatch[1]!, 10);

    if (marketplace === 'shopee') {
      return await convertShopeeForAffiliate(originalUrl, userId);
    }

    if (marketplace === 'mercadolivre') {
      return await convertMlForAffiliate(originalUrl, userId);
    }

    // Para Amazon ou outros: tenta conversão global como fallback
    const { convertUrl } = await import('@omestre/converters');
    const result = await convertUrl(originalUrl);
    return {
      convertedUrl: result.affiliateUrl,
      marketplace,
      success: result.success,
    };
  } catch (err) {
    log('warn', 'Falha ao converter URL', {
      url: originalUrl,
      marketplace,
      affiliateId,
      error: String(err),
    });
    return { convertedUrl: null, marketplace, success: false };
  }
}

/**
 * Converte URL da Shopee usando as credenciais do usuário.
 */
async function convertShopeeForAffiliate(
  url: string,
  userId: number,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
}> {
  const credsRepo = new UserCredentialsRepository();
  const creds = await credsRepo.findByUserId(userId);

  if (creds?.shopeeAppId && creds?.shopeeAppSecret) {
    // Usa credenciais do afiliado
    const result = await convertShopeeUrlWithCredentials(url, {
      appId: creds.shopeeAppId,
      secret: creds.shopeeAppSecret,
    });
    return {
      convertedUrl: result.affiliateUrl,
      marketplace: 'shopee',
      success: result.success,
    };
  }

  // Fallback: credenciais globais do .env
  log('info', 'Sem credenciais Shopee específicas — usando fallback global', { userId });
  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'shopee',
    success: result.success,
  };
}

/**
 * Converte URL do Mercado Livre usando o afiliado ML vinculado ao usuário.
 *
 * Estratégias (em ordem):
 *   1. Link curto (meli.la) via API interna + cookies de sessão
 *   2. URL params (?meliid=&melitat=) como fallback
 */
async function convertMlForAffiliate(
  url: string,
  userId: number,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
}> {
  const mlRepo = new MlAffiliateRepository();
  const mlAffiliate = await mlRepo.findByPlatformUserId(userId);

  if (mlAffiliate?.melitat) {
    // ── Estratégia 1: Link curto via cookies ──
    if (mlAffiliate.sessionCookies) {
      const shortResult = await generateShortAffiliateLink(
        url,
        mlAffiliate.melitat,
        mlAffiliate.sessionCookies,
      );

      if (shortResult.success && shortResult.shortUrl) {
        return {
          convertedUrl: shortResult.shortUrl,
          marketplace: 'mercadolivre',
          success: true,
        };
      }

      // Se falhou por cookie expirado (401/403), tenta URL params
      if (
        shortResult.error?.includes('HTTP 40') ||
        shortResult.error?.includes('Cookies podem estar expirados')
      ) {
        // Continua pra estratégia 2
      } else {
        return {
          convertedUrl: null,
          marketplace: 'mercadolivre',
          success: false,
          // non-success with error message preserved
        };
      }
    }

    // ── Estratégia 2: URL params (fallback) ──
    try {
      let targetUrl = url;
      if (/meli\.la\//i.test(url)) {
        const resolved = await fetch(url, { method: 'HEAD', redirect: 'manual' });
        const location = resolved.headers.get('location');
        if (location && location !== url) {
          targetUrl = location;
        }
      }

      const affiliateUrl = generateViaUrlParams(targetUrl, {
        meliid: mlAffiliate.meliid ?? undefined,
        melitat: mlAffiliate.melitat,
      });

      return {
        convertedUrl: affiliateUrl,
        marketplace: 'mercadolivre',
        success: true,
      };
    } catch (err) {
      return {
        convertedUrl: null,
        marketplace: 'mercadolivre',
        success: false,
      };
    }
  }

  // Fallback global
  log('info', 'Sem afiliado ML vinculado — usando fallback global', { userId });
  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'mercadolivre',
    success: result.success,
  };
}

/**
 * Registra a oferta refletida no banco.
 */
async function logReflectedOffer(params: {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string | null;
  marketplace: string;
  messagePreview: string;
  status: 'sent' | 'failed';
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(reflectedOffers).values({
      affiliateId: params.affiliateId,
      sourceGroupJid: params.sourceGroupJid,
      targetGroupJid: params.targetGroupJid,
      originalLink: params.originalLink,
      convertedLink: params.convertedLink ?? params.originalLink, // fallback: usa original se falhou
      marketplace: params.marketplace as 'shopee' | 'mercadolivre' | 'amazon' | 'unknown',
      messagePreview: params.messagePreview.slice(0, 500),
      status: params.status,
    });
  } catch (err) {
    log('error', 'Erro ao registrar reflected_offer', {
      error: String(err),
      ...params,
    });
  }
}

/**
 * Monta o template da mensagem formatada para o grupo de destino.
 *
 * Estrutura:
 *   🛒 *Oferta Detectada*
 *   {texto original com link convertido}
 *   ──────────────────
 *   📌 Enviado por @omestre
 */
function buildTemplateMessage(
  originalText: string,
  originalUrl: string,
  convertedUrl: string | null,
): string {
  // Substitui a URL original pela convertida no texto
  let text = originalText;
  if (convertedUrl) {
    text = text.replace(originalUrl, convertedUrl);
  }

  // Se o texto for muito longo, trunca
  const maxLen = 4000;
  if (text.length > maxLen) {
    text = text.slice(0, maxLen - 50) + '...';
  }

  return text;
}

// ─── Pipeline Principal ──────────────────────────────────────────────

/**
 * Processa uma única mensagem de espelhamento.
 * Retorna true se foi processada com sucesso para pelo menos um targetGroup.
 */
export async function processMirrorMessage(event: MirrorMessageEvent): Promise<boolean> {
  const { messageId, instanceName, sourceGroupJid, affiliateId, text, timestamp } = event;

  log('info', 'Processando mensagem de espelhamento', {
    messageId,
    instanceName,
    sourceGroupJid,
    affiliateId,
    textLength: text.length,
    timestamp,
  });

  // ── 1. Extrai URL de marketplace ──────────────────────────────────
  const originalUrl = extractMarketplaceUrl(text);
  if (!originalUrl) {
    log('info', 'Mensagem sem URL de marketplace — ignorada', { messageId });
    return false;
  }

  const marketplace = detectMarketplace(originalUrl);
  log('info', 'URL de marketplace detectada', { messageId, originalUrl, marketplace });

  // ── 2. Filtros (blacklist) ────────────────────────────────────────
  const filters = await getFilters(affiliateId);
  if (filters?.blacklist?.length) {
    for (const term of filters.blacklist) {
      if (text.toLowerCase().includes(term.toLowerCase())) {
        log('info', 'Mensagem filtrada por blacklist', { messageId, term });
        return false;
      }
    }
  }

  // ── 3. Dedup ──────────────────────────────────────────────────────
  const dedupHours = filters?.dedupHours ?? 24;
  const duplicate = await isDuplicate(affiliateId, originalUrl, dedupHours);
  if (duplicate) {
    log('info', 'Oferta duplicada — ignorada', { messageId, originalUrl, dedupHours });
    return false;
  }

  // ── 4. Converte link ──────────────────────────────────────────────
  const { convertedUrl, success: conversionSuccess } = await convertOfferUrl(
    originalUrl,
    affiliateId,
    instanceName,
  );

  // ── 5. Busca grupos de destino ────────────────────────────────────
  const targetGroups = await getTargetGroups(affiliateId);
  if (targetGroups.length === 0) {
    log('warn', 'Nenhum grupo de destino configurado', { affiliateId });
    return false;
  }

  // ── 6. Monta template ─────────────────────────────────────────────
  const template = buildTemplateMessage(text, originalUrl, convertedUrl);
  log('info', 'Template montado', {
    messageId,
    templateLength: template.length,
    hasConvertedUrl: !!convertedUrl,
  });

  // ── 7. Envia para cada grupo de destino ──────────────────────────
  let anySent = false;
  const finalStatus = conversionSuccess ? 'sent' : 'failed';

  for (const target of targetGroups) {
    const sent = await sendToGroup(instanceName, target.jid, template);
    if (sent) {
      anySent = true;
      log('info', 'Mensagem enviada para grupo de destino', {
        messageId,
        targetGroupJid: target.jid,
        targetGroupName: target.name,
      });
    } else {
      log('error', 'Falha ao enviar para grupo de destino', {
        messageId,
        targetGroupJid: target.jid,
      });
    }

    // ── 8. Log no banco ───────────────────────────────────────────
    await logReflectedOffer({
      affiliateId,
      sourceGroupJid,
      targetGroupJid: target.jid,
      originalLink: originalUrl,
      convertedLink: convertedUrl,
      marketplace,
      messagePreview: template,
      status: sent ? finalStatus : 'failed',
    });
  }

  return anySent;
}
