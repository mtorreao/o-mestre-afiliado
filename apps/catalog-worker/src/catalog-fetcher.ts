/**
 * catalog-fetcher — Busca dado FRESCO do produto na fonte.
 *
 * Especificação: docs/plans/historico-precos.md §3.2
 *
 * O CatalogWorker recebe só a identidade (CatalogJob) e é DONO de buscar
 * o dado atualizado:
 *
 *   - ML: GET https://api.mercadolibre.com/items/{id} (público, sem auth)
 *         → title, pictures[0].url, variations[] (id/price/original_price/
 *           available_quantity/attribute_combinations)
 *   - Shopee: getProductOffer(resolvedUrl, creds) (GraphQL) — creds
 *         resolvidas por userId via user_credentials
 *   - Amazon/outros: price null (fase futura) — sem fetch
 *
 * Nenhuma lógica de negócio aqui: parsing/mapeamento vive em catalog-pure.
 * Este módulo é I/O puro (fetch), aceito abaixo da meta de cobertura —
 * o parsing é testado em catalog-pure.
 */
import type { CatalogJob } from '@omestre/shared';
import { getProductOffer } from '@omestre/converters';
import type { UserCredentialsRepository } from '@omestre/db';
import type { MlFetchedItem, ShopeeFetchedOffer } from '@omestre/db';

// ─── Config ──────────────────────────────────────────────────────────

const ML_ITEMS_API = 'https://api.mercadolibre.com/items/';

// ─── Resultado ───────────────────────────────────────────────────────

export type CatalogFetched =
  | { kind: 'ml'; item: MlFetchedItem }
  | { kind: 'shopee'; offer: ShopeeFetchedOffer }
  | { kind: 'none'; reason: string };

// ─── ML ──────────────────────────────────────────────────────────────

/**
 * Busca item na API pública do ML.
 * Retorna null em qualquer erro de rede/HTTP (não lança).
 */
export async function fetchMlItem(
  itemId: string,
  fetcher: typeof fetch = fetch,
): Promise<MlFetchedItem | null> {
  try {
    const res = await fetcher(`${ML_ITEMS_API}${itemId}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    return data as unknown as MlFetchedItem;
  } catch {
    return null;
  }
}

// ─── Shopee ──────────────────────────────────────────────────────────

/**
 * Resolve credenciais Shopee do usuário via user_credentials.
 * Retorna null se não houver creds (userId null ou não encontrado).
 */
export async function resolveShopeeCredentials(
  userId: number | null,
  credentialsRepo: Pick<UserCredentialsRepository, 'findByUserId'> | null,
): Promise<{ appId: string; secret: string } | null> {
  if (userId == null || !credentialsRepo) return null;
  try {
    const row = await credentialsRepo.findByUserId(userId);
    if (!row?.shopeeAppId || !row.shopeeAppSecret) return null;
    return { appId: row.shopeeAppId, secret: row.shopeeAppSecret };
  } catch {
    return null;
  }
}

/**
 * Busca oferta Shopee via getProductOffer (GraphQL).
 * Retorna null em erro (não lança).
 */
export async function fetchShopeeOffer(
  resolvedUrl: string,
  creds: { appId: string; secret: string },
): Promise<ShopeeFetchedOffer | null> {
  try {
    const offer = await getProductOffer(resolvedUrl, creds);
    if (!offer) return null;
    return offer as unknown as ShopeeFetchedOffer;
  } catch {
    return null;
  }
}

// ─── Dispatcher principal ────────────────────────────────────────────

export interface FetchCatalogInput {
  job: CatalogJob;
  /** Repositório de credenciais (injetado p/ teste). Null → Shopee sem creds. */
  credentialsRepo: Pick<UserCredentialsRepository, 'findByUserId'> | null;
}

/**
 * Busca o dado fresco do produto conforme o marketplace do job.
 *
 * - ML: items API pública.
 * - Shopee: getProductOffer com creds do userId.
 * - Amazon/outros: sem fetch nesta fase (kind 'none').
 *
 * NUNCA lança — retorna CatalogFetched com o resultado.
 */
export async function fetchCatalogData(
  input: FetchCatalogInput,
  fetcher: typeof fetch = fetch,
): Promise<CatalogFetched> {
  const { job } = input;

  switch (job.marketplace) {
    case 'mercadolivre': {
      const item = await fetchMlItem(job.itemId, fetcher);
      return item ? { kind: 'ml', item } : { kind: 'none', reason: 'ml_fetch_failed' };
    }
    case 'shopee': {
      const creds = await resolveShopeeCredentials(job.userId, input.credentialsRepo);
      if (!creds) return { kind: 'none', reason: 'shopee_no_credentials' };
      const offer = await fetchShopeeOffer(job.resolvedUrl, creds);
      return offer ? { kind: 'shopee', offer } : { kind: 'none', reason: 'shopee_fetch_failed' };
    }
    default:
      // amazon/magalu/unknown — fase futura; sem fetch (spec §3.2)
      return { kind: 'none', reason: `unsupported_marketplace:${job.marketplace}` };
  }
}
