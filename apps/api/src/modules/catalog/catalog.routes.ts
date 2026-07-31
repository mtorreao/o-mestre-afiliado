/**
 * Rotas read-only do catálogo de produtos (histórico de preços).
 *
 * Conforme docs/plans/historico-precos.md §5.5.2:
 *   - Todas as rotas exigem JWT válido + `isAdmin=true`.
 *   - Sem token / token não-admin -> 403 { success: false } (mesmo contrato
 *     do módulo admin/feature-flags).
 *   - Leitura-only: nada aqui escreve no banco.
 */
import { Elysia } from 'elysia';
import { CatalogRepository, marketplaceEnum } from '@omestre/db';
import type { CatalogMarketplace } from '@omestre/db';
import { makeLogger } from '@omestre/shared';
import { createJwtPlugin, getAdminUser } from '../../middleware/auth.ts';

const log = makeLogger('api:catalog');
const repo = new CatalogRepository();

export const catalogRoutes = new Elysia()
  .use(createJwtPlugin())

  // GET /api/catalog/products — lista paginada com filtros
  .get(
    '/api/catalog/products',
    async ({ query, jwt, request: { headers }, set }) => {
      const admin = await getAdminUser(jwt, headers);
      if (!admin) {
        set.status = 403;
        return { success: false, error: 'Não autorizado' };
      }

      const q = query as Record<string, string | undefined>;
      try {
        const marketplace = parseMarketplace(q.marketplace);
        const result = await repo.listProducts({
          marketplace,
          search: q.search || undefined,
          page: q.page ? parseInt(q.page, 10) : undefined,
          pageSize: q.pageSize ? parseInt(q.pageSize, 10) : undefined,
        });
        return { success: true, ...result };
      } catch (err) {
        log('error', 'Erro ao listar produtos do catálogo', err);
        return { success: false, error: 'Erro interno' };
      }
    },
    {
      detail: {
        summary: 'Listar produtos do catálogo (admin)',
        description:
          'Lista paginada de products com agregados de variações e preço. Filtros: marketplace, search (título).',
      },
    },
  )

  // GET /api/catalog/products/:id — detalhe + variações + série temporal
  .get(
    '/api/catalog/products/:id',
    async ({ params, jwt, request: { headers }, set }) => {
      const admin = await getAdminUser(jwt, headers);
      if (!admin) {
        set.status = 403;
        return { success: false, error: 'Não autorizado' };
      }

      const productId = Number(params.id);
      if (!Number.isInteger(productId) || productId <= 0) {
        return { success: false, error: 'ID inválido' };
      }

      try {
        const detail = await repo.getProductWithVariations(productId);
        if (!detail) {
          return { success: false, error: 'Produto não encontrado' };
        }
        return { success: true, ...detail };
      } catch (err) {
        log('error', 'Erro ao buscar detalhe do produto', err);
        return { success: false, error: 'Erro interno' };
      }
    },
    {
      detail: {
        summary: 'Detalhe do produto (admin)',
        description: 'Produto + variações + preview da série temporal de preços.',
      },
    },
  )

  // GET /api/catalog/variations/:id/history — série temporal com filtro de período
  .get(
    '/api/catalog/variations/:id/history',
    async ({ params, query, jwt, request: { headers }, set }) => {
      const admin = await getAdminUser(jwt, headers);
      if (!admin) {
        set.status = 403;
        return { success: false, error: 'Não autorizado' };
      }

      const variationId = Number(params.id);
      if (!Number.isInteger(variationId) || variationId <= 0) {
        return { success: false, error: 'ID inválido' };
      }

      const q = query as Record<string, string | undefined>;
      try {
        const points = await repo.getVariationHistory(variationId, {
          from: q.from,
          to: q.to,
        });
        if (!points) {
          return { success: false, error: 'Variação não encontrada' };
        }
        return { success: true, points };
      } catch (err) {
        log('error', 'Erro ao buscar histórico da variação', err);
        return { success: false, error: 'Erro interno' };
      }
    },
    {
      detail: {
        summary: 'Histórico de preços de uma variação (admin)',
        description:
          'Pontos de preço de uma variação ordenados por capturedAt ASC. Filtros opcionais: from, to (ISO).',
      },
    },
  );

function parseMarketplace(raw: string | undefined): CatalogMarketplace | undefined {
  if (!raw) return undefined;
  const values = marketplaceEnum.enumValues as readonly string[];
  return values.includes(raw) ? (raw as CatalogMarketplace) : undefined;
}
