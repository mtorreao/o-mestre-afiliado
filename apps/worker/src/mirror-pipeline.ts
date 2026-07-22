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
import { convertShopeeUrlWithCredentials, generateViaUrlParams, generateShortAffiliateLink, convertAmazonUrlWithTrackingId } from '@omestre/converters';
import { getDb, affiliates, reflectedOffers, UserCredentialsRepository, MlAffiliateRepository, AffiliatesRepository } from '@omestre/db';
import {
  getCachedConversion,
  setCachedConversion,
} from './conversion-cache.ts';
import { eq, and, gte } from 'drizzle-orm';
import {
  incrementCounter,
  observeHistogram,
} from './metrics.ts';
import {
  processFailure,
  classifyConversionError,
} from './notifier.ts';
import { pushToDLQ } from './dead-letter-queue.ts';
import { tryAcquireSlot, waitForSlot } from './rate-limiter.ts';

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
 * Delay promise para backoff.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Envia mensagem de texto para um grupo via Evolution API com retry.
 *
 * Antes de cada tentativa, verifica o rate limit (Redis) para a instância.
 * Se o limite por janela for excedido, aguarda até o reset e tenta
 * novamente — nenhuma mensagem é descartada, apenas atrasada.
 *
 * Retry: 3 tentativas com backoff exponencial (2s, 4s, 8s).
 */
async function sendToGroup(
  instanceName: string,
  groupJid: string,
  text: string,
): Promise<boolean> {
  const maxAttempts = 3;
  const delays: number[] = [2_000, 4_000, 8_000]; // ms

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // ── Rate limit check ──────────────────────────────────────────
    // Tenta adquirir slot antes de enviar. Se excedeu o limite da
    // janela, espera até o próximo ciclo (sem descartar mensagem).
    const { acquired, waitMs } = await tryAcquireSlot(instanceName);
    if (!acquired) {
      log('info', 'Rate limit atingido — aguardando reset da janela', {
        instanceName,
        waitMs,
        attempt,
      });
      incrementCounter('mirror_rate_limited_total', { instance_name: instanceName });
      incrementCounter('mirror_rate_limit_wait_ms_total');

      const gotSlot = await waitForSlot(instanceName);
      if (!gotSlot) {
        log('error', 'Rate limit — timeout ao aguardar slot disponível', {
          instanceName,
          groupJid,
          attempt,
        });
        incrementCounter('mirror_failures_total', { type: 'rate_limited', marketplace: 'unknown' });
        return false;
      }
    }

    // ── Envio ─────────────────────────────────────────────────────
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

      if (res.ok) {
        if (attempt > 1) {
          log('info', 'Mensagem enviada com sucesso após retry', {
            instanceName,
            groupJid,
            attempt,
          });
        }
        return true;
      }

      const body = await res.text();

      // Última tentativa — loga como erro final
      if (attempt === maxAttempts) {
        log('error', 'Falha ao enviar mensagem após todas as tentativas', {
          instanceName,
          groupJid,
          status: res.status,
          body,
          attempts: attempt,
        });
        return false;
      }

      log('warn', 'Falha ao enviar mensagem, tentando novamente', {
        instanceName,
        groupJid,
        status: res.status,
        attempt,
        nextRetryMs: delays[attempt - 1],
      });
    } catch (err) {
      // Última tentativa — loga como erro final
      if (attempt === maxAttempts) {
        log('error', 'Erro ao enviar mensagem após todas as tentativas', {
          instanceName,
          groupJid,
          error: err instanceof Error ? err.message : String(err),
          attempts: attempt,
        });
        return false;
      }

      log('warn', 'Erro ao enviar mensagem, tentando novamente', {
        instanceName,
        groupJid,
        error: err instanceof Error ? err.message : String(err),
        attempt,
        nextRetryMs: delays[attempt - 1],
      });
    }

    // Aguarda backoff exponencial antes de tentar novamente
    await sleep(delays[attempt - 1]!);
  }

  return false;
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
 * Busca o template de mensagem personalizado do afiliado.
 * Retorna null se não configurado (usa o template padrão).
 */
async function getMessageTemplate(
  affiliateId: number,
): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ messageTemplate: affiliates.messageTemplate })
      .from(affiliates)
      .where(eq(affiliates.id, affiliateId))
      .limit(1);

    if (!rows[0]) return null;
    return rows[0].messageTemplate ?? null;
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
  error?: string;
}> {
  const marketplace = detectMarketplace(originalUrl);

  if (marketplace === 'unknown') {
    return { convertedUrl: null, marketplace, success: false };
  }

  // ── Cache check ─────────────────────────────────────────────────────
  // Se a mesma URL já foi convertida recentemente, reaproveita o resultado
  const cached = await getCachedConversion(originalUrl);
  if (cached) {
    log('info', 'Cache hit — URL já convertida recentemente', {
      url: originalUrl,
      marketplace: cached.marketplace,
      cachedAt: cached.timestamp,
    });
    return {
      convertedUrl: cached.convertedUrl,
      marketplace: cached.marketplace,
      success: cached.convertedUrl !== null,
    };
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
        error: result.error,
      };
    }

    const userId = parseInt(userIdMatch[1]!, 10);

    if (marketplace === 'shopee') {
      return await convertShopeeForAffiliate(originalUrl, userId);
    }

    if (marketplace === 'mercadolivre') {
      return await convertMlForAffiliate(originalUrl, userId);
    }

    if (marketplace === 'amazon') {
      return await convertAmazonForAffiliate(originalUrl, userId);
    }

    // Para outros marketplaces: tenta conversão global como fallback
    const { convertUrl } = await import('@omestre/converters');
    const result = await convertUrl(originalUrl);
    return {
      convertedUrl: result.affiliateUrl,
      marketplace,
      success: result.success,
      error: result.error,
    };
  } catch (err) {
    log('warn', 'Falha ao converter URL', {
      url: originalUrl,
      marketplace,
      affiliateId,
      error: String(err),
    });
    return { convertedUrl: null, marketplace, success: false, error: String(err) };
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
  error?: string;
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
      error: result.error,
    };
  }

  // Fallback: credenciais globais do .env
  log('info', 'Sem credenciais Shopee específicas — usando fallback global', { userId });

  // Notifica credenciais Shopee inválidas/ausentes (agrupado, com cooldown)
  const instanceName = `user-${userId}`;
  processFailure(instanceName, 'invalid_shopee_creds', { marketplace: 'shopee' }).catch(() => {});

  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'shopee',
    success: result.success,
    error: result.error,
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
  error?: string;
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
        // Notifica cookie expirado (agrupado, com cooldown)
        const instanceName = `user-${userId}`;
        processFailure(instanceName, 'cookie_expired', { marketplace: 'mercadolivre' }).catch(() => {});
        // Continua pra estratégia 2
      } else {
        return {
          convertedUrl: null,
          marketplace: 'mercadolivre',
          success: false,
          error: shortResult.error,
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
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // Fallback global
  log('info', 'Sem afiliado ML vinculado — usando fallback global', { userId });

  // Notifica conta ML não vinculada (agrupado, com cooldown)
  const instanceName = `user-${userId}`;
  processFailure(instanceName, 'ml_account_not_linked', { marketplace: 'mercadolivre' }).catch(() => {});

  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'mercadolivre',
    success: result.success,
    error: result.error,
  };
}

/**
 * Converte URL da Amazon usando o tracking ID do afiliado.
 *
 * Estratégia:
 *   1. Busca UserCredentials do usuário → amazonTrackingId
 *   2. Constrói URL com ?tag={trackingId}
 */
async function convertAmazonForAffiliate(
  url: string,
  userId: number,
): Promise<{
  convertedUrl: string | null;
  marketplace: string;
  success: boolean;
  error?: string;
}> {
  const credsRepo = new UserCredentialsRepository();
  const creds = await credsRepo.findByUserId(userId);

  if (creds?.amazonTrackingId) {
    const result = await convertAmazonUrlWithTrackingId(url, creds.amazonTrackingId);
    return {
      convertedUrl: result.affiliateUrl,
      marketplace: 'amazon',
      success: result.success,
      error: result.error,
    };
  }

  // Fallback: tracking ID global do .env
  log('info', 'Sem tracking ID Amazon específico — usando fallback global', { userId });
  const { convertUrl } = await import('@omestre/converters');
  const result = await convertUrl(url);
  return {
    convertedUrl: result.affiliateUrl,
    marketplace: 'amazon',
    success: result.success,
    error: result.error,
  };
}

/**
 * Registra a oferta refletida no banco.
 * Suporta status 'sent', 'failed' e 'blocked' (com block_reason).
 */
async function logReflectedOffer(params: {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string | null;
  marketplace: string;
  messagePreview: string;
  status: 'sent' | 'failed' | 'blocked';
  failureReason?: string;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(reflectedOffers).values({
      affiliateId: params.affiliateId,
      sourceGroupJid: params.sourceGroupJid,
      targetGroupJid: params.targetGroupJid,
      originalLink: params.originalLink,
      convertedLink: params.convertedLink ?? params.originalLink,
      marketplace: params.marketplace as 'shopee' | 'mercadolivre' | 'amazon' | 'unknown',
      messagePreview: params.messagePreview.slice(0, 500),
      status: params.status,
      failureReason: params.failureReason ?? null,
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
 * Suporta placeholders:
 *   {texto_original}   — texto original com o link convertido
 *   {link_convertido}  — apenas o link convertido (sem contexto)
 *
 * Se template for null/vazio, usa o comportamento padrão (texto com link trocado).
 */
function buildTemplateMessage(
  originalText: string,
  originalUrl: string,
  convertedUrl: string | null,
  template: string | null,
): string {
  // Substitui a URL original pela convertida no texto
  let textWithConvertedLink = originalText;
  if (convertedUrl) {
    textWithConvertedLink = textWithConvertedLink.replace(originalUrl, convertedUrl);
  }

  if (template) {
    // Usa o template personalizado com placeholders
    let result = template
      .replace(/\{texto_original\}/g, textWithConvertedLink)
      .replace(/\{link_convertido\}/g, convertedUrl ?? originalUrl);

    // Se o resultado for muito longo, trunca
    const maxLen = 4000;
    if (result.length > maxLen) {
      result = result.slice(0, maxLen - 50) + '...';
    }

    return result;
  }

  // Comportamento padrão: texto original com link trocado
  let text = textWithConvertedLink;

  // Se o texto for muito longo, trunca
  const maxLen = 4000;
  if (text.length > maxLen) {
    text = text.slice(0, maxLen - 50) + '...';
  }

  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// AFILIATE LINK VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica se o link convertido contém os parâmetros de afiliado
 * corretos para o afiliado dono do grupo destino.
 *
 * Serve como segurança contra:
 *   - Cache collisions (o cache é indexado por URL, não por afiliado)
 *   - URLs origem que já continham parâmetros de outro afiliado
 *   - Bugs na função de conversão que gerem params errados
 *
 * Para ML: inspeciona meliid, melitat, matt_word na URL convertida
 *   e confere se batem com o afiliado ML vinculado ao usuário.
 *   Links curtos meli.la (sem params visíveis) são aprovados — a
 *   própria API do ML gerou com as credenciais corretas.
 *
 * Para Amazon: verifica o parâmetro ?tag= contra o tracking ID
 *   do afiliado.
 *
 * Para Shopee: a URL é gerada pela API oficial da Shopee com as
 *   credenciais autenticadas na chamada — não há params visíveis
 *   para verificar, então confia-se na API.
 *
 * @param convertedUrl — URL já convertida (pode ser null se falhou)
 * @param affiliateId — ID do afiliado (tabela `affiliates`)
 * @param marketplace — marketplace detectado
 * @returns { valid, reason? } — valid=false bloqueia a mensagem
 */
export async function verifyAffiliateLink(
  convertedUrl: string | null,
  affiliateId: number,
  marketplace: string,
): Promise<{ valid: boolean; reason?: string }> {
  if (!convertedUrl) {
    // Sem URL convertida = será bloqueado pelo passo 4b;
    // não é nosso papel impedir aqui.
    return { valid: true };
  }

  try {
    if (marketplace === 'mercadolivre') {
      return await verifyMercadoLivreLink(convertedUrl, affiliateId);
    }

    if (marketplace === 'amazon') {
      return await verifyAmazonLink(convertedUrl, affiliateId);
    }

    // Shopee e outros: URLs geradas pela API oficial com autenticação
    // na chamada — não há parâmetros visíveis para inspecionar.
    return { valid: true };
  } catch (err) {
    log('warn', 'Erro ao verificar link de afiliado — permitindo por segurança', {
      affiliateId,
      marketplace,
      error: String(err),
    });
    return { valid: true };
  }
}

/**
 * Verifica parâmetros de afiliado ML (meliid, melitat, matt_word)
 * na URL convertida contra o afiliado ML vinculado ao usuário.
 *
 * Extrai o userId do evolutionInstanceId do afiliado e busca
 * o registro correspondente em ml_affiliates.
 */
async function verifyMercadoLivreLink(
  convertedUrl: string,
  affiliateId: number,
): Promise<{ valid: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(convertedUrl);
  } catch {
    return { valid: false, reason: 'URL convertida inválida para verificação ML' };
  }

  const params = url.searchParams;

  // Extrai parâmetros de afiliado da URL convertida
  const urlMeliid = params.get('meliid');
  const urlMelitat = params.get('melitat');
  const urlMattWord = params.get('matt_word');

  // Se não tem nenhum parâmetro de afiliado ML, pode ser um link
  // curto meli.la (estratégia 1 — API/cookies) — confiamos porque
  // a própria API do ML gerou com as credenciais corretas.
  if (!urlMeliid && !urlMelitat && !urlMattWord) {
    return { valid: true };
  }

  // Busca o affiliate no banco para obter o evolutionInstanceId
  const db = getDb();
  const affRows = await db
    .select({ evolutionInstanceId: affiliates.evolutionInstanceId })
    .from(affiliates)
    .where(eq(affiliates.id, affiliateId))
    .limit(1);

  if (!affRows[0]?.evolutionInstanceId) {
    return { valid: false, reason: 'Afiliado sem evolutionInstanceId' };
  }

  const userIdMatch = affRows[0].evolutionInstanceId.match(/^user-(\d+)$/);
  if (!userIdMatch) {
    return { valid: false, reason: 'evolutionInstanceId sem formato user-{userId}' };
  }

  const userId = parseInt(userIdMatch[1]!, 10);
  const mlRepo = new MlAffiliateRepository();
  const mlAffiliate = await mlRepo.findByPlatformUserId(userId);

  if (!mlAffiliate) {
    // Se a URL tem params ML mas o usuário não tem afiliado ML
    // configurado, os params vieram de algum lugar suspeito.
    return { valid: false, reason: 'URL com parâmetros ML mas afiliado não vinculado' };
  }

  // ── Verifica melitat (formato antigo: ?melitat=XXXX) ──────────
  if (urlMelitat && mlAffiliate.melitat) {
    if (urlMelitat !== mlAffiliate.melitat) {
      return {
        valid: false,
        reason: `melitat não corresponde ao afiliado: esperado ${mlAffiliate.melitat}, recebido ${urlMelitat}`,
      };
    }
  } else if (urlMelitat && !mlAffiliate.melitat) {
    return {
      valid: false,
      reason: 'melitat presente na URL mas afiliado não possui melitat configurado',
    };
  }

  // ── Verifica matt_word (formato novo: ?matt_word=XXXX) ────────
  if (urlMattWord && mlAffiliate.melitat) {
    if (urlMattWord !== mlAffiliate.melitat) {
      return {
        valid: false,
        reason: `matt_word não corresponde ao afiliado: esperado ${mlAffiliate.melitat}, recebido ${urlMattWord}`,
      };
    }
  } else if (urlMattWord && !mlAffiliate.melitat) {
    return {
      valid: false,
      reason: 'matt_word presente na URL mas afiliado não possui melitat configurado',
    };
  }

  // ── Verifica meliid (opcional — formato antigo) ────────────────
  if (urlMeliid && mlAffiliate.meliid) {
    if (urlMeliid !== mlAffiliate.meliid) {
      return {
        valid: false,
        reason: `meliid não corresponde ao afiliado: esperado ${mlAffiliate.meliid}, recebido ${urlMeliid}`,
      };
    }
  }

  return { valid: true };
}

/**
 * Verifica o parâmetro ?tag= em URLs da Amazon contra o tracking ID
 * do afiliado.
 */
async function verifyAmazonLink(
  convertedUrl: string,
  affiliateId: number,
): Promise<{ valid: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(convertedUrl);
  } catch {
    return { valid: false, reason: 'URL convertida inválida para verificação Amazon' };
  }

  const urlTag = url.searchParams.get('tag');
  if (!urlTag) {
    // Sem tag na URL — nada a verificar (pode ser um link curto
    // amzn.to que a conversão não conseguiu resolver)
    return { valid: true };
  }

  // Busca o affiliate no banco para obter o evolutionInstanceId
  const db = getDb();
  const affRows = await db
    .select({ evolutionInstanceId: affiliates.evolutionInstanceId })
    .from(affiliates)
    .where(eq(affiliates.id, affiliateId))
    .limit(1);

  if (!affRows[0]?.evolutionInstanceId) {
    return { valid: false, reason: 'Afiliado sem evolutionInstanceId' };
  }

  const userIdMatch = affRows[0].evolutionInstanceId.match(/^user-(\d+)$/);
  if (!userIdMatch) {
    return { valid: false, reason: 'evolutionInstanceId sem formato user-{userId}' };
  }

  const userId = parseInt(userIdMatch[1]!, 10);
  const credsRepo = new UserCredentialsRepository();
  const creds = await credsRepo.findByUserId(userId);

  if (creds?.amazonTrackingId) {
    if (urlTag !== creds.amazonTrackingId) {
      return {
        valid: false,
        reason: `Amazon tag não corresponde ao afiliado: esperado ${creds.amazonTrackingId}, recebido ${urlTag}`,
      };
    }
  }

  return { valid: true };
}

// ─── Pipeline Principal ──────────────────────────────────────────────

/**
 * Processa uma única mensagem de espelhamento.
 * Retorna true se foi processada com sucesso para pelo menos um targetGroup.
 */
export async function processMirrorMessage(event: MirrorMessageEvent): Promise<boolean> {
  const { messageId, instanceName, sourceGroupJid, sourceGroupName, affiliateId, text, timestamp } = event;

  log('info', 'Processando mensagem de espelhamento', {
    messageId,
    instanceName,
    sourceGroupJid,
    sourceGroupName: sourceGroupName || '(desconhecido)',
    affiliateId,
    textLength: text.length,
    timestamp,
  });

  incrementCounter('mirror_messages_received_total');

  // ── 1. Extrai URL de marketplace ──────────────────────────────────
  const originalUrl = extractMarketplaceUrl(text);
  if (!originalUrl) {
    log('info', 'Mensagem sem URL de marketplace — ignorada', { messageId });
    incrementCounter('mirror_messages_blocked_total', { reason: 'no_url' });
    await logReflectedOffer({
      affiliateId,
      sourceGroupJid,
      targetGroupJid: '',
      originalLink: text.slice(0, 500),
      convertedLink: null,
      marketplace: 'unknown',
      messagePreview: text.slice(0, 300),
      status: 'blocked',
      failureReason: 'no_url: mensagem sem URL de marketplace detectada',
    });
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
        incrementCounter('mirror_messages_blocked_total', { reason: 'blacklist' });
        await logReflectedOffer({
          affiliateId,
          sourceGroupJid,
          targetGroupJid: '',
          originalLink: originalUrl,
          convertedLink: null,
          marketplace,
          messagePreview: text.slice(0, 300),
          status: 'blocked',
          failureReason: `blacklist: termo "${term}" encontrado na mensagem`,
        });
        return false;
      }
    }
  }

  // ── 2b. Filtro por keywords (whitelist) ──────────────────────────
  if (filters?.keywords?.length) {
    const textLower = text.toLowerCase();
    const hasKeyword = filters.keywords.some(kw => textLower.includes(kw.toLowerCase()));
    if (!hasKeyword) {
      log('info', 'Mensagem filtrada por keywords — nenhuma keyword encontrada', { messageId, keywords: filters.keywords });
      incrementCounter('mirror_messages_blocked_total', { reason: 'no_keyword_match' });
      await logReflectedOffer({
        affiliateId,
        sourceGroupJid,
        targetGroupJid: '',
        originalLink: originalUrl,
        convertedLink: null,
        marketplace,
        messagePreview: text.slice(0, 300),
        status: 'blocked',
        failureReason: `keywords: mensagem não contém nenhuma keyword da lista [${filters.keywords.join(', ')}]`,
      });
      return false;
    }
  }

  // ── 3. Dedup ──────────────────────────────────────────────────────
  const dedupHours = filters?.dedupHours ?? 24;
  const duplicate = await isDuplicate(affiliateId, originalUrl, dedupHours);
  if (duplicate) {
    log('info', 'Oferta duplicada — ignorada', { messageId, originalUrl, dedupHours });
    incrementCounter('mirror_deduplicated_total');
    await logReflectedOffer({
      affiliateId,
      sourceGroupJid,
      targetGroupJid: '',
      originalLink: originalUrl,
      convertedLink: null,
      marketplace,
      messagePreview: text.slice(0, 300),
      status: 'blocked',
      failureReason: `dedup: oferta duplicada dentro da janela de ${dedupHours}h`,
    });
    return false;
  }

  // ── 4. Converte link ──────────────────────────────────────────────
  const conversionStart = performance.now();
  const { convertedUrl, success: conversionSuccess, error: conversionError } = await convertOfferUrl(
    originalUrl,
    affiliateId,
    instanceName,
  );
  const conversionDuration = (performance.now() - conversionStart) / 1000;

  if (conversionSuccess) {
    incrementCounter('mirror_messages_converted_total', { marketplace });

    // Cache o resultado da conversão (apenas sucessos) para reaproveitar
    // se a mesma URL surgir em outro grupo fonte
    await setCachedConversion(originalUrl, {
      convertedUrl,
      marketplace,
      timestamp: new Date().toISOString(),
    });
  } else {
    incrementCounter('mirror_failures_total', { type: 'conversion_failed', marketplace });
    incrementCounter('mirror_messages_blocked_total', { reason: 'conversion_failed' });
    log('info', 'Conversão falhou — bloqueado para não vazar link de terceiro', {
      messageId,
      originalUrl,
      marketplace,
      error: conversionError,
    });

    // Classifica o erro e notifica se for algo que o usuário pode corrigir.
    // Os erros específicos (cookie_expired, ml_account_not_linked,
    // invalid_shopee_creds) já são notificados dentro de convertOfferUrl
    // (via processFailure nas funções específicas de cada marketplace).
    // Este bloco captura tipos adicionais como refresh_token_expired
    // que não são explicitamente tratados nos conversores.
    if (conversionError) {
      const failureType = classifyConversionError(marketplace, conversionError);
      if (failureType) {
        processFailure(instanceName, failureType, { marketplace }).catch(() => {});
      }
    }
  }
  observeHistogram('mirror_conversion_duration_seconds', conversionDuration, { marketplace });

  // ── 4b. Bloqueia se conversão falhou ──────────────────────────────
  // Impede envio de mensagens com link não convertido (vazamento de links de terceiros)
  if (!conversionSuccess) {
    // Envia para a Dead Letter Queue para debug e análise de padrões de falha
    await pushToDLQ({
      event,
      failureReason: 'conversion_failed',
      attempts: 1,
      lastError: conversionError || `URL não pôde ser convertida para link de afiliado: ${originalUrl}`,
      marketplace,
      originalUrl,
      conversionSuccess: false,
    });

    // Log detalhado do bloqueio para auditoria
    await logReflectedOffer({
      affiliateId,
      sourceGroupJid,
      targetGroupJid: '',
      originalLink: originalUrl,
      convertedLink: null,
      marketplace,
      messagePreview: text.slice(0, 300),
      status: 'blocked',
      failureReason: conversionError || `conversão falhou: ${marketplace} — URL não pôde ser convertida para link de afiliado`,
    });
    return false;
  }

  // ── 4c. Verifica se o link convertido pertence ao afiliado ──────────
  // Segurança: inspeciona parâmetros de afiliado na URL convertida
  // (meliid, melitat, matt_word para ML; tag para Amazon) e confere
  // se correspondem ao afiliado dono do grupo destino.
  // Impede cache collisions e vazamento de links de terceiros.
  const { valid: linkValid, reason: linkReason } = await verifyAffiliateLink(
    convertedUrl,
    affiliateId,
    marketplace,
  );
  if (!linkValid) {
    log('warn', 'Link convertido não corresponde ao afiliado — bloqueado', {
      messageId,
      affiliateId,
      marketplace,
      reason: linkReason,
    });
    incrementCounter('mirror_messages_blocked_total', { reason: 'affiliate_link_mismatch' });
    await logReflectedOffer({
      affiliateId,
      sourceGroupJid,
      targetGroupJid: '',
      originalLink: originalUrl,
      convertedLink: convertedUrl,
      marketplace,
      messagePreview: text.slice(0, 300),
      status: 'blocked',
      failureReason: `parâmetro de afiliado não confere: ${linkReason ?? 'motivo desconhecido'}`,
    });
    return false;
  }

  // ── 5. Busca grupos de destino ────────────────────────────────────
  const targetGroups = await getTargetGroups(affiliateId);
  if (targetGroups.length === 0) {
    log('warn', 'Nenhum grupo de destino configurado', { affiliateId });
    incrementCounter('mirror_messages_blocked_total', { reason: 'no_target_groups' });
    await logReflectedOffer({
      affiliateId,
      sourceGroupJid,
      targetGroupJid: '',
      originalLink: originalUrl,
      convertedLink: convertedUrl,
      marketplace,
      messagePreview: text.slice(0, 300),
      status: 'blocked',
      failureReason: 'sem grupos de destino: afiliado sem targetGroups configurados',
    });
    return false;
  }

  // ── 6. Monta template ─────────────────────────────────────────────
  const messageTemplate = await getMessageTemplate(affiliateId);
  const hasCustomTemplate = !!messageTemplate;
  const template = buildTemplateMessage(text, originalUrl, convertedUrl, messageTemplate);
  log('info', 'Template montado', {
    messageId,
    templateLength: template.length,
    hasConvertedUrl: !!convertedUrl,
    hasCustomTemplate,
  });

  // ── 7. Envia para cada grupo de destino ──────────────────────────
  let anySent = false;
  const failedTargetJids: string[] = [];
  const finalStatus = conversionSuccess ? 'sent' : 'failed';

  for (const target of targetGroups) {
    const sent = await sendToGroup(instanceName, target.jid, template);
    if (sent) {
      anySent = true;
      incrementCounter('mirror_messages_sent_total');
      log('info', 'Mensagem enviada para grupo de destino', {
        messageId,
        targetGroupJid: target.jid,
        targetGroupName: target.name,
      });
    } else {
      failedTargetJids.push(target.jid);
      incrementCounter('mirror_failures_total', { type: 'send_failed', marketplace });
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

  // ── 9. Dead Letter Queue — mensagem não enviada para NENHUM grupo ──
  // Se a mensagem foi validada e convertida mas não conseguiu ser entregue
  // em nenhum grupo de destino, vai para a DLQ para análise manual.
  if (!anySent && targetGroups.length > 0) {
    await pushToDLQ({
      event,
      failureReason: 'send_failed',
      attempts: 3,
      lastError: `Falha ao enviar para todos os ${targetGroups.length} grupos de destino`,
      marketplace,
      originalUrl,
      conversionSuccess,
      targetGroupJids: failedTargetJids,
    });
  }

  return anySent;
}
