import { Elysia, t } from 'elysia';
import { FeatureFlagRepository } from '@omestre/db';
import { makeLogger } from '@omestre/shared';
import { createJwtPlugin, getAdminUser } from '../../middleware/auth.ts';
import {
  FLAGS,
  ALL_FLAG_KEYS,
  countFlagChecks,
  invalidateFlagCache,
  publishFlagInvalidation,
} from '@omestre/feature-flags';
import type { FlagKey } from '@omestre/feature-flags';

const log = makeLogger('api:admin:feature-flags');
const flagRepo = new FeatureFlagRepository();

export const featureFlagsRoutes = new Elysia()
  .use(createJwtPlugin())

  // GET /api/admin/feature-flags — lista todas as flags com status
  .get('/api/admin/feature-flags', async ({ jwt, request: { headers } }) => {
    const admin = await getAdminUser(jwt, headers);
    if (!admin) return { success: false, error: 'Não autorizado' };

    try {
      const rows = await flagRepo.findAll();
      const rowsMap = new Map(
        rows.map(
          (r: { key: string; enabled: boolean; updatedBy: string | null; updatedAt: Date }) => [
            r.key,
            r,
          ],
        ),
      );

      const flags = await Promise.all(
        ALL_FLAG_KEYS.map(async (key: string) => {
          const def = FLAGS[key]!;
          const row = rowsMap.get(key);
          const checksLastHour = await countFlagChecks(key);
          return {
            key,
            label: def.label,
            description: def.description,
            category: def.category ?? 'Geral',
            enabled: row?.enabled ?? def.defaultEnabled,
            danger: def.danger,
            checksLastHour,
            updatedBy: row?.updatedBy ?? null,
            updatedAt: row?.updatedAt?.toISOString() ?? null,
          };
        }),
      );

      return { success: true, flags };
    } catch (err) {
      log('error', 'Erro ao listar feature flags', err);
      return { success: false, error: 'Erro interno' };
    }
  })

  // PATCH /api/admin/feature-flags/:key — altera o estado de uma flag
  .patch(
    '/api/admin/feature-flags/:key',
    async ({
      jwt,
      request: { headers },
      params,
      body,
    }: {
      jwt: any;
      request: { headers: Headers };
      params: { key: string };
      body: { enabled: boolean };
    }) => {
      const admin = await getAdminUser(jwt, headers);
      if (!admin) return { success: false, error: 'Não autorizado' };

      const { key } = params;
      const { enabled } = body;

      if (!ALL_FLAG_KEYS.includes(key as FlagKey)) {
        return { success: false, error: `Flag desconhecida: ${key}` };
      }

      try {
        const row = await flagRepo.upsert(key, enabled, admin.userEmail);
        invalidateFlagCache(key);
        publishFlagInvalidation(key);
        return {
          success: true,
          flag: {
            key,
            enabled: row.enabled,
            updatedBy: row.updatedBy,
            updatedAt: row.updatedAt?.toISOString() ?? null,
          },
        };
      } catch (err) {
        log('error', 'Erro ao atualizar feature flag', err);
        return { success: false, error: 'Erro interno' };
      }
    },
    {
      body: t.Object({
        enabled: t.Boolean(),
      }),
    },
  );
