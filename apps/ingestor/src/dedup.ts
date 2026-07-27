/**
 * Dedup de ofertas espelhadas em janela de 24h (DB).
 *
 * Verifica na tabela `reflected_offers` se uma oferta com a mesma
 * `originalLink` foi enviada nas últimas N horas para o afiliado.
 * Falha de DB é silenciosa (fail-open: assume não-duplicado).
 */
import { and, eq, gte } from 'drizzle-orm';
import { getDb, reflectedOffers } from '@omestre/db';
import { makeLogger } from '@omestre/shared';

const log = makeLogger('ingestor');

/**
 * Verifica se a oferta é duplicada dentro da janela `dedupHours`.
 *
 * Retorna true se já foi enviada (deve ser descartada) ou false se
 * é nova (deve prosseguir). Erros de DB resultam em false (fail-open)
 * para não bloquear o pipeline por falha de infra.
 */
export async function isDuplicate(
  affiliateId: number,
  originalUrl: string,
  dedupHours = 24,
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
    return false;
  }
}
