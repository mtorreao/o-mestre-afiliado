import { Elysia, t } from 'elysia';
import { FeatureFlagRepository } from '@omestre/db';
import { makeLogger } from '@omestre/shared';
import { createJwtPlugin, getAdminUser } from '../../middleware/auth.ts';
import type { AuthUser } from '../../middleware/auth.ts';
import {
  FLAGS,
  ALL_FLAG_KEYS,
  countFlagChecks,
  invalidateFlagCache,
  publishFlagInvalidation,
} from '@omestre/feature-flags';
import type { FlagKey, FlagDefinition } from '@omestre/feature-flags';

const log = makeLogger('api:admin:feature-flags');

interface FlagRow {
  key: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

/**
 * Dependências injetáveis da rota (para testes sem DB/Redis reais).
 * Os defaults são os módulos de produção; os testes passam fakes.
 */
export interface FeatureFlagsDeps {
  flagRepo?: Pick<FeatureFlagRepository, 'findAll' | 'upsert'>;
  getAdmin?: typeof getAdminUser;
  flags?: Record<string, FlagDefinition>;
  allFlagKeys?: readonly string[];
  countFlagChecks?: typeof countFlagChecks;
  invalidateFlagCache?: typeof invalidateFlagCache;
  publishFlagInvalidation?: typeof publishFlagInvalidation;
}

export function createFeatureFlagsRoutes(deps: FeatureFlagsDeps = {}) {
  const {
    flagRepo = new FeatureFlagRepository(),
    getAdmin = getAdminUser,
    flags = FLAGS,
    allFlagKeys = ALL_FLAG_KEYS,
    countFlagChecks: countChecks = countFlagChecks,
    invalidateFlagCache: invalidateCache = invalidateFlagCache,
    publishFlagInvalidation: publishInvalidation = publishFlagInvalidation,
  } = deps;

  return (
    new Elysia()
      .use(createJwtPlugin())

      // GET /api/admin/feature-flags — lista todas as flags com status
      .get('/api/admin/feature-flags', async ({ jwt, request: { headers } }) => {
        const admin = await getAdmin(jwt, headers);
        if (!admin) return { success: false, error: 'Não autorizado' };

        try {
          const rows = await flagRepo.findAll();
          const rowsMap = new Map<string, FlagRow>(rows.map((r: FlagRow) => [r.key, r]));

          const list = await Promise.all(
            allFlagKeys.map(async (key: string) => {
              const def = flags[key]!;
              const row = rowsMap.get(key);
              const checksLastHour = await countChecks(key);
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

          return { success: true, flags: list };
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
          const admin = await getAdmin(jwt, headers);
          if (!admin) return { success: false, error: 'Não autorizado' };

          const { key } = params;
          const { enabled } = body;

          if (!allFlagKeys.includes(key as FlagKey)) {
            return { success: false, error: `Flag desconhecida: ${key}` };
          }

          try {
            const row = await flagRepo.upsert(key, enabled, admin.userEmail);
            invalidateCache(key);
            publishInvalidation(key);
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
      )
  );
}

/** Rota default de produção (mesma factory usada nos testes). */
export const featureFlagsRoutes = createFeatureFlagsRoutes();
