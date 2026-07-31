/**
 * Lógica PURA do Ingestor (ingestor.ts).
 *
 * Separa as DECISÕES de classificação/processamento e a MONTAGEM de
 * objetos (template context, send event) da orquestração assíncrona com
 * I/O (Redis, fetch de imagem, publish na Queue B, ACK). Todas as funções
 * aqui são síncronas, determinísticas e 100% testáveis sem rede/Redis.
 *
 * O I/O fica em `ingestor.ts`, que consome este módulo.
 *
 * Funções extraídas de dentro dos blocos async de `processRawMessage`
 * (que antes eram inline e portanto não-cobertas pelos testes unitários):
 *   - classifyResolvedProductUrl: decide se URL resolvida é 'product' por
 *     marketplace (regex de produto Shopee/ML/Amazon + fallback Magalu)
 *   - reconstructText            : aplica substituições informative/discard
 *     + limpeza de separadores órfãos no texto sanitizado
 *   - buildTemplateContext       : monta o TemplateContext do send event
 *   - buildSendEvent             : monta o SendEvent (id injetável p/ teste)
 *   - resolveSendDedupKey        : chave de send-dedup (mirror + messageId)
 *   - parseAffiliateUserId       : extrai o userId do instanceName user-<id>
 *   - isSocialCommerceUrl        : detecta URL /social/<id> do ML
 */

import type { Marketplace } from '@omestre/shared';
import { detectMarketplace } from '@omestre/shared';
import { MIRROR_SEND_DEDUP_PREFIX } from '@omestre/shared';
import { isMeliProductUrl } from './resolve-redirect.ts';

// ─── Classificação de URL resolvida (product vs informativa) ──────────────

/**
 * Decide se uma URL de marketplace resolvida é uma página de PRODUTO,
 * dado o marketplace detectado.
 *
 * Espelha a lógica inline de `processRawMessage` (passo 2):
 *   - shopee:   /-i.<ShopId>.<ItemId> ou /<slug>/<ShopId>/<ItemId>
 *   - ml:       isMeliProductUrl (usa o util já puro de resolve-redirect)
 *   - amazon:   /dp/<ASIN> ou /gp/product/<ASIN>
 *   - magalu:   tratado como produto (chega à conversão, onde é bloqueado
 *               com "Marketplace ainda não liberado")
 *   - outros conhecidos: false
 *
 * Função PURO.
 */
export function classifyResolvedProductUrl(
  resolvedUrl: string,
  marketplace: Marketplace | 'unknown',
): boolean {
  if (marketplace === 'shopee') {
    return /-i\.\d+\.\d+/i.test(resolvedUrl) || /\/\d{6,}\/\d{6,}/i.test(resolvedUrl);
  }
  if (marketplace === 'mercadolivre') {
    return isMeliProductUrl(resolvedUrl);
  }
  if (marketplace === 'amazon') {
    return (
      /\/dp\/[A-Z0-9]{10}/i.test(resolvedUrl) || /\/gp\/product\/[A-Z0-9]{10}/i.test(resolvedUrl)
    );
  }
  // Marketplaces conhecidos mas sem integração (ex: Magalu) são tratados
  // como "produto" para que cheguem à etapa de conversão.
  if (marketplace === 'magalu') {
    return true;
  }
  return false;
}

// ─── Reconstrução do texto ───────────────────────────────────────────────

export interface ResolvedLinkInput {
  originalUrl: string;
  resolvedUrl: string;
  role: 'product' | 'informative' | 'discard';
}

/**
 * Reconstrói o texto da mensagem a partir do texto sanitizado e da lista de
 * links resolvidos:
 *   - 'informative' → substitui originalUrl pela resolvedUrl
 *   - 'discard'     → remove originalUrl (link e separador órfão)
 *   - 'product'     → não substituído aqui (será pelo template)
 *
 * Ao final, limpa separadores "|" órfãos no fim de linha, espaços duplos e
 * 3+ quebras de linha, e faz trim.
 *
 * Função PURO — não altera as entradas.
 */
export function reconstructText(sanitizedText: string, resolvedLinks: ResolvedLinkInput[]): string {
  let processedText = sanitizedText;
  for (const rl of resolvedLinks) {
    if (rl.role === 'informative') {
      processedText = processedText.replace(rl.originalUrl, rl.resolvedUrl);
    } else if (rl.role === 'discard') {
      processedText = processedText.replace(rl.originalUrl, '');
    }
  }
  processedText = processedText.replace(/\s*\|\s*$/gm, '');
  processedText = processedText.replace(/[ \t]{2,}/g, ' ');
  processedText = processedText.replace(/\n{3,}/g, '\n\n');
  return processedText.trim();
}

// ─── Montagem de TemplateContext / SendEvent ─────────────────────────────

/**
 * Monta o TemplateContext usado por `buildTemplateMessage`.
 * Extraído da montagem inline no fan-out de `processRawMessage`.
 * Função PURO.
 */
export function buildTemplateContext(params: {
  processedText: string;
  originalUrl: string;
  convertedUrl: string;
  marketplace: string;
  sourceGroupName: string;
  targetGroupName: string;
  timestamp: Date;
}): import('@omestre/shared').TemplateContext {
  return {
    originalText: params.processedText,
    originalUrl: params.originalUrl,
    convertedUrl: params.convertedUrl,
    marketplace: params.marketplace,
    sourceGroupName: params.sourceGroupName || '(desconhecido)',
    targetGroupName: params.targetGroupName,
    timestamp: params.timestamp,
  };
}

/**
 * Monta um SendEvent pronto para publicação na Queue B.
 * `id` é injetável (default randomUUID) para testes determinísticos.
 * Função PURO.
 */
export function buildSendEvent(params: {
  id: string;
  sourceMessageId: string;
  sourceGroupJid: string;
  mirrorId: number;
  text: string;
  marketplace: string;
  originalUrl: string;
  convertedUrl: string;
  /** Chave de correlação marketplace:itemId (catálogo, Queue C) — opcional nesta fase */
  productKey?: string;
}): import('@omestre/shared').SendEvent {
  return {
    id: params.id,
    sourceMessageId: params.sourceMessageId,
    sourceGroupJid: params.sourceGroupJid,
    mirrorId: params.mirrorId,
    text: params.text,
    imageUrl: '', // preenchido após o fan-out (busca única de imagem)
    marketplace: params.marketplace,
    originalUrl: params.originalUrl,
    convertedUrl: params.convertedUrl,
    ...(params.productKey ? { productKey: params.productKey } : {}),
  };
}

// ─── Chave de send-dedup ─────────────────────────────────────────────────

/**
 * Chave Redis de send-dedup: `${PREFIX}${mirrorId}:${messageId}`.
 * Usada para idempotência de publicação (crash recovery).
 * Função PURO.
 */
export function resolveSendDedupKey(mirrorId: number | string, messageId: string): string {
  return `${MIRROR_SEND_DEDUP_PREFIX}${mirrorId}:${messageId}`;
}

// ─── Parse de instanceName → userId (Mercado Livre) ──────────────────────

/**
 * Extrai o userId de plataforma de um instanceName no formato `user-<id>`.
 * Implementação única em @omestre/shared (convenção `user-<id>` usada também
 * pela API e pelo backfill do CatalogWorker) — re-export mantém os
 * consumidores deste módulo intactos.
 */
export { parseAffiliateUserId } from '@omestre/shared';

// ─── Detecção de URL de social commerce (ML) ─────────────────────────────

/**
 * Detecta se a URL do Mercado Livre é uma página de social commerce
 * (`/social/<id>`), que precisa de resolução adicional para o produto real.
 * Função PURO.
 */
export function isSocialCommerceUrl(resolvedUrl: string): boolean {
  try {
    return /^\/social\/[a-zA-Z0-9]+\/?$/i.test(new URL(resolvedUrl).pathname);
  } catch {
    return false;
  }
}
