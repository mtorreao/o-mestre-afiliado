/**
 * Verificação de safety do link de afiliado gerado.
 *
 * Garante que o convertedUrl usa os parâmetros corretos para o afiliado
 * (melitat/meliid/matt_word no ML, tag na Amazon). Se detectar mismatch,
 * retorna { valid: false, reason } — o pipeline bloqueia a oferta.
 *
 * Apenas ML e Amazon são verificados — Shopee não tem como o Link Builder
 * retornar URL com credenciais de outro afiliado.
 */
import { eq } from 'drizzle-orm';
import { getDb, affiliates, MlAffiliateRepository, AmazonAffiliateRepository } from '@omestre/db';
import { makeLogger } from '@omestre/shared';

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

/**
 * Verifica que os parâmetros ML no convertedUrl (meliid/melitat/matt_word)
 * correspondem ao afiliado configurado. Sem um deles, considera válido
 * (parâmetros opcionais — pode ser só URL simples).
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
  const urlMeliid = params.get('meliid');
  const urlMelitat = params.get('melitat');
  const urlMattWord = params.get('matt_word');

  if (!urlMeliid && !urlMelitat && !urlMattWord) {
    return { valid: true };
  }

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
    return { valid: false, reason: 'URL com parâmetros ML mas afiliado não vinculado' };
  }

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
 * Verifica que a tag Amazon no convertedUrl está nos trackingIds ativos
 * do afiliado. Sem tag na URL, considera válido.
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
  if (!urlTag) return { valid: true };

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
  const amazonRepo = new AmazonAffiliateRepository();
  const amazonAffiliate = await amazonRepo.findByUserId(userId);

  if (amazonAffiliate && (amazonAffiliate.trackingIds ?? []).length > 0) {
    const activeTags = (amazonAffiliate.trackingIds ?? [])
      .filter((t) => t.active)
      .map((t) => t.tag);
    if (urlTag && !activeTags.includes(urlTag)) {
      return {
        valid: false,
        reason: `Amazon tag não corresponde ao afiliado: esperado um de [${activeTags.join(', ')}], recebido ${urlTag}`,
      };
    }
  }

  return { valid: true };
}
