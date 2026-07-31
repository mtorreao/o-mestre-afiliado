import { Elysia, t } from 'elysia';
import { FeatureFlagRepository } from '@omestre/db';
import { makeLogger } from '@omestre/shared';
import { createJwtPlugin, getAuthUser } from '../../middleware/auth.ts';
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
 * Helper compartilhado: autentica o caller e exige role admin.
 *  - Sem token ou token inválido → 401
 *  - Token válido mas sem role admin → 403
 *  - Token admin → retorna AuthUser
 *
 * Necessário para distinguir 401 (auth ausente) de 403 (auth sem
 * permissão), em vez de colapsar os dois casos num único HTTP 200
 * com `{ success:false }` (bug pre-existente).
 *
 * O primeiro argumento é a função de auth injetável (default: getAuthUser),
 * para que os testes consigam controlar 401/403 sem mock de módulo.
 */
async function requireAdmin(
  getAuth: typeof getAuthUser,
  jwtInstance: {
    verify: (token: string) => Promise<Record<string, unknown> | null | false>;
  },
  headers: Headers,
  set: { status?: number | string },
): Promise<{ ok: true; user: AuthUser } | { ok: false; status: 401 | 403; error: string }> {
  const user = await getAuth(jwtInstance, headers);
  if (!user) {
    set.status = 401;
    return { ok: false, status: 401, error: 'Não autenticado' };
  }
  if (!user.isAdmin) {
    set.status = 403;
    return { ok: false, status: 403, error: 'Acesso restrito a administradores' };
  }
  return { ok: true, user };
}

/**
 * Dependências injetáveis da rota (para testes sem DB/Redis reais).
 * Os defaults são os módulos de produção; os testes passam fakes.
 */
export interface FeatureFlagsDeps {
  flagRepo?: Pick<FeatureFlagRepository, 'findAll' | 'upsert'>;
  getAdmin?: typeof getAuthUser;
  flags?: Record<string, FlagDefinition>;
  allFlagKeys?: readonly string[];
  countFlagChecks?: typeof countFlagChecks;
  invalidateFlagCache?: typeof invalidateFlagCache;
  publishFlagInvalidation?: typeof publishFlagInvalidation;
}

export function createFeatureFlagsRoutes(deps: FeatureFlagsDeps = {}) {
  const {
    flagRepo = new FeatureFlagRepository(),
    getAdmin = getAuthUser,
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
      .get('/api/admin/feature-flags', async ({ jwt, request: { headers }, set }) => {
        const auth = await requireAdmin(getAdmin, jwt, headers, set);
        if (!auth.ok) return { success: false, error: auth.error };

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
          set,
          params,
          body,
        }: {
          jwt: any;
          request: { headers: Headers };
          set: { status?: number | string };
          params: { key: string };
          body: { enabled: boolean };
        }) => {
          const auth = await requireAdmin(getAdmin, jwt, headers, set);
          if (!auth.ok) return { success: false, error: auth.error };

          const { key } = params;
          const { enabled } = body;

          if (!allFlagKeys.includes(key as FlagKey)) {
            return { success: false, error: `Flag desconhecida: ${key}` };
          }

          try {
            const row = await flagRepo.upsert(key, enabled, auth.user.userEmail);
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
