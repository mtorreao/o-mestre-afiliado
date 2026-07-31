/**
 * Lógica PURA de verificação de link de afiliado.
 *
 * Separa a tomada de decisão (comparação de parâmetros) da camada de
 * I/O (DB / repositórios). Todas as funções aqui são síncronas e não
 * dependem de serviços externos, facilitando 100% de cobertura via
 * testes unitários sem mocks de infra.
 *
 * A orquestração com DB fica em `link-verifier.ts`, que apenas alimenta
 * estas funções com os dados persistidos.
 */

import type { AmazonTrackingId } from '@omestre/db';

// ─── Tipos ───────────────────────────────────────────────────────────

/** Parâmetros de afiliação extraídos de uma URL convertida. */
export interface ExtractedAffiliateParams {
  /** Parâmetro meliid (formato antigo ML). */
  meliid: string | null;
  /** Parâmetro melitat (etiqueta do afiliado ML). */
  melitat: string | null;
  /** Parâmetro matt_word (formato novo ML). */
  mattWord: string | null;
  /** Parâmetro tag (Amazon). */
  tag: string | null;
}

/** Dados mínimos do afiliado ML para verificação de parâmetros. */
export interface MlAffiliateParams {
  meliid: string | null;
  melitat: string | null;
}

/** Resultado de uma verificação de parâmetros. */
export interface ParamVerification {
  valid: boolean;
  reason?: string;
}

// ─── Extração de parâmetros da URL ───────────────────────────────────

/**
 * Extrai os parâmetros de afiliação de uma URL de afiliado convertida.
 *
 * Lança `Error` se a URL for inválida (não puder ser parseada).
 * Retorna `null` em `convertUrl === null`.
 */
export function extractAffiliateParams(convertedUrl: string): ExtractedAffiliateParams {
  let url: URL;
  try {
    url = new URL(convertedUrl);
  } catch {
    throw new Error('URL convertida inválida para extração de parâmetros');
  }

  const params = url.searchParams;
  return {
    meliid: params.get('meliid'),
    melitat: params.get('melitat'),
    mattWord: params.get('matt_word'),
    tag: params.get('tag'),
  };
}

// ─── Verificação Mercado Livre ───────────────────────────────────────

/**
 * Verifica se os parâmetros ML extraídos da URL correspondem ao afiliado.
 *
 * Regras:
 *  - Sem nenhum dos três parâmetros (meliid/melitat/matt_word) → válido
 *    (URL simples, sem credenciais de afiliado embutidas).
 *  - Parâmetro presente na URL mas ausente no afiliado → inválido.
 *  - Parâmetro presente em ambos mas divergente → inválido.
 *  - Todos os presentes conferem → válido.
 */
export function verifyMlParams(
  extracted: ExtractedAffiliateParams,
  affiliate: MlAffiliateParams,
): ParamVerification {
  const { meliid: urlMeliid, melitat: urlMelitat, mattWord: urlMattWord } = extracted;

  if (!urlMeliid && !urlMelitat && !urlMattWord) {
    return { valid: true };
  }

  // melitat
  if (urlMelitat && affiliate.melitat) {
    if (urlMelitat !== affiliate.melitat) {
      return {
        valid: false,
        reason: `melitat não corresponde ao afiliado: esperado ${affiliate.melitat}, recebido ${urlMelitat}`,
      };
    }
  } else if (urlMelitat && !affiliate.melitat) {
    return {
      valid: false,
      reason: 'melitat presente na URL mas afiliado não possui melitat configurado',
    };
  }

  // matt_word (deve conferir com melitat do afiliado)
  if (urlMattWord && affiliate.melitat) {
    if (urlMattWord !== affiliate.melitat) {
      return {
        valid: false,
        reason: `matt_word não corresponde ao afiliado: esperado ${affiliate.melitat}, recebido ${urlMattWord}`,
      };
    }
  } else if (urlMattWord && !affiliate.melitat) {
    return {
      valid: false,
      reason: 'matt_word presente na URL mas afiliado não possui melitat configurado',
    };
  }

  // meliid
  if (urlMeliid && affiliate.meliid) {
    if (urlMeliid !== affiliate.meliid) {
      return {
        valid: false,
        reason: `meliid não corresponde ao afiliado: esperado ${affiliate.meliid}, recebido ${urlMeliid}`,
      };
    }
  } else if (urlMeliid && !affiliate.meliid) {
    return {
      valid: false,
      reason: 'meliid presente na URL mas afiliado não possui meliid configurado',
    };
  }

  return { valid: true };
}

// ─── Verificação Amazon ──────────────────────────────────────────────

/**
 * Verifica se a tag Amazon extraída da URL está entre os tracking IDs ativos
 * do afiliado.
 *
 * Regras:
 *  - Sem tag na URL → válido (URL simples).
 *  - Sem tracking IDs ativos → válido (não há como conferir; mantém
 *    comportamento fail-open do verificador original).
 *  - Tag ausente dos ativos → inválido.
 */
export function verifyAmazonTag(
  tag: string | null,
  trackingIds: AmazonTrackingId[],
): ParamVerification {
  if (!tag) return { valid: true };

  const ids = trackingIds ?? [];

  // Afiliado sem nenhum tracking ID cadastrado → não há como conferir.
  // Fail-open (mantém comportamento original do verificador).
  if (ids.length === 0) {
    return { valid: true };
  }

  const activeTags = ids.filter((t) => t.active).map((t) => t.tag);

  if (!activeTags.includes(tag)) {
    return {
      valid: false,
      reason: `Amazon tag não corresponde ao afiliado: esperado um de [${activeTags.join(', ')}], recebido ${tag}`,
    };
  }

  return { valid: true };
}

// ─── Verificação Magalu ──────────────────────────────────────────────

/** Dados mínimos do afiliado Magalu para verificação do store slug. */
export interface MagaluAffiliateParams {
  storeSlug: string;
}

/**
 * Verifica se o slug do Magazine Você na URL convertida corresponde ao
 * afiliado. Sem slug na URL → válido (assume que conversão preservou o
 * slug — URLs magazineluiza.com.br sem slug não carregam identidade de
 * afiliado).
 */
export function verifyMagaluStoreSlug(
  extractedSlug: string | null,
  affiliate: MagaluAffiliateParams,
): ParamVerification {
  if (!extractedSlug) return { valid: true };
  if (extractedSlug !== affiliate.storeSlug) {
    return {
      valid: false,
      reason: `Magalu store_slug não corresponde ao afiliado: esperado ${affiliate.storeSlug}, recebido ${extractedSlug}`,
    };
  }
  return { valid: true };
}

/**
 * Extrai o store slug de uma URL convertida do Magazine Você.
 *
 * O slug é o primeiro segmento do pathname de `magazinevoce.com.br`
 * (`/{slug}/...`). Retorna `null` para URLs de outros domínios (ex:
 * magazineluiza.com.br sem slug, OneLink) — sem slug de loja não há
 * identidade de afiliado para conferir, e a verificação é fail-open.
 */
export function extractMagaluStoreSlug(convertedUrl: string): string | null {
  try {
    const url = new URL(convertedUrl);
    if (!/magazinevoce\.com\.br/i.test(url.hostname)) {
      return null;
    }
    // pathname começa com /{slug}/... ou /{slug}
    const match = url.pathname.match(/^\/([a-z0-9-]+)(\/|$)/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// ─── Utilidades ──────────────────────────────────────────────────────

/**
 * Extrai o userId numérico de um `evolutionInstanceId` no formato
 * `user-{userId}`. Retorna `null` se não casar o padrão.
 */
export function extractUserIdFromInstanceId(
  evolutionInstanceId: string | null | undefined,
): number | null {
  if (!evolutionInstanceId) return null;
  const match = evolutionInstanceId.match(/^user-(\d+)$/);
  if (!match) return null;
  const userId = parseInt(match[1]!, 10);
  return Number.isNaN(userId) ? null : userId;
}
