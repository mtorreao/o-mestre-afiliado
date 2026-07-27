/**
 * Verificação de safety do link de afiliado gerado.
 *
 * Garante que o convertedUrl usa os parâmetros corretos para o afiliado
 * (melitat/meliid/matt_word no ML, tag na Amazon). Se detectar mismatch,
 * retorna { valid: false, reason } — o pipeline bloqueia a oferta.
 *
 * Apenas ML e Amazon são verificados — Shopee não tem como o Link Builder
 * retornar URL com credenciais de outro afiliado.
 *
 * A lógica de comparação de parâmetros foi extraída para
 * `link-verifier-pure.ts` (funções puras, sem I/O), e este módulo apenas
 * orquestra o acesso a DB/repositórios e alimenta aquelas funções.
 */
import { eq } from 'drizzle-orm';
import { getDb, affiliates, MlAffiliateRepository, AmazonAffiliateRepository } from '@omestre/db';
import { makeLogger } from '@omestre/shared';
import {
  extractAffiliateParams,
  verifyMlParams,
  verifyAmazonTag,
  extractUserIdFromInstanceId,
} from './link-verifier-pure.ts';

const log = makeLogger('ingestor');

/**
 * Verifica se o convertedUrl é válido para o afiliado.
 *
 * Por marketplace:
 *  - ML: se tem meliid/melitat/matt_word na URL, confere com o afiliado.
 *  - Amazon: se tem tag na URL, confere com trackingIds ativos.
 *  - Shopee: sempre válido.
 *
 * Falha de DB → retorna válido (fail-open: não bloqueia por erro de infra).
 */
export async function verifyAffiliateLink(
  convertedUrl: string | null,
  affiliateId: number,
  marketplace: string,
): Promise<{ valid: boolean; reason?: string }> {
  if (!convertedUrl) return { valid: true };

  try {
    if (marketplace === 'mercadolivre') {
      return await verifyMercadoLivreLink(convertedUrl, affiliateId);
    }
    if (marketplace === 'amazon') {
      return await verifyAmazonLink(convertedUrl, affiliateId);
    }
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

/** Busca o userId da plataforma a partir do affiliateId (via evolutionInstanceId). */
async function resolveUserId(affiliateId: number): Promise<number | null> {
  const db = getDb();
  const affRows = await db
    .select({ evolutionInstanceId: affiliates.evolutionInstanceId })
    .from(affiliates)
    .where(eq(affiliates.id, affiliateId))
    .limit(1);

  if (!affRows[0]?.evolutionInstanceId) {
    return null;
  }
  return extractUserIdFromInstanceId(affRows[0].evolutionInstanceId);
}

/**
 * Verifica que os parâmetros ML no convertedUrl (meliid/melitat/matt_word)
 * correspondem ao afiliado configurado. Sem um deles, considera válido
 * (parâmetros opcionais — pode ser só URL simples).
 */
async function verifyMercadoLivreLink(
  convertedUrl: string,
  affiliateId: number,
): Promise<{ valid: boolean; reason?: string }> {
  let extracted;
  try {
    extracted = extractAffiliateParams(convertedUrl);
  } catch {
    return { valid: false, reason: 'URL convertida inválida para verificação ML' };
  }

  // URL sem nenhum parâmetro ML → válida por definição.
  if (!extracted.meliid && !extracted.melitat && !extracted.mattWord) {
    return { valid: true };
  }

  const userId = await resolveUserId(affiliateId);
  if (userId === null) {
    return { valid: false, reason: 'Afiliado sem evolutionInstanceId' };
  }

  const mlRepo = new MlAffiliateRepository();
  const mlAffiliate = await mlRepo.findByPlatformUserId(userId);

  if (!mlAffiliate) {
    return { valid: false, reason: 'URL com parâmetros ML mas afiliado não vinculado' };
  }

  return verifyMlParams(extracted, {
    meliid: mlAffiliate.meliid,
    melitat: mlAffiliate.melitat,
  });
}

/**
 * Verifica que a tag Amazon no convertedUrl está nos trackingIds ativos
 * do afiliado. Sem tag na URL, considera válido.
 */
async function verifyAmazonLink(
  convertedUrl: string,
  affiliateId: number,
): Promise<{ valid: boolean; reason?: string }> {
  let extracted;
  try {
    extracted = extractAffiliateParams(convertedUrl);
  } catch {
    return { valid: false, reason: 'URL convertida inválida para verificação Amazon' };
  }

  if (!extracted.tag) return { valid: true };

  const userId = await resolveUserId(affiliateId);
  if (userId === null) {
    return { valid: false, reason: 'Afiliado sem evolutionInstanceId' };
  }

  const amazonRepo = new AmazonAffiliateRepository();
  const amazonAffiliate = await amazonRepo.findByUserId(userId);

  if (amazonAffiliate && (amazonAffiliate.trackingIds ?? []).length > 0) {
    return verifyAmazonTag(extracted.tag, amazonAffiliate.trackingIds ?? []);
  }

  return { valid: true };
}
