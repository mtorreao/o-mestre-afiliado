/**
 * Rotas de feature flags no admin-api (Hono).
 *
 * GET  /api/admin/feature-flags           → lista flags com status + checksLastHour
 * PATCH /api/admin/feature-flags/:key     body { enabled } → upsert + invalida cache
 *
 * Auth: sessionAuth() — admin-api é single-user, sem distinção admin/non-admin.
 *
 * Dependências injetáveis (deps): permitem testar sem DB/Redis reais:
 *   - flagRepo               : FeatureFlagRepository (default = new FeatureFlagRepository())
 *   - getFlagRedis           : getFlagRedis do SDK
 *   - flags                  : registry de definições (default = FLAGS do @omestre/feature-flags)
 *   - allFlagKeys            : chaves válidas (default = ALL_FLAG_KEYS)
 *   - countFlagChecks        : somador de checks na última hora
 *   - publishFlagInvalidation: pub/sub broadcaster
 */

import { Hono } from 'hono';
import { FeatureFlagRepository } from '@omestre/db';
import { getFlagRedis, publishFlagInvalidation, countFlagChecks } from '@omestre/feature-flags-sdk';
import { FLAGS, ALL_FLAG_KEYS } from '@omestre/feature-flags';
import type { FlagDefinition } from '@omestre/feature-flags';
import type { Logger } from '../config.ts';
import { sessionAuth, type AuthEnv } from '../auth.ts';

interface FlagRow {
  key: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface FeatureFlagsDeps {
  log?: Logger;
  flagRepo?: Pick<FeatureFlagRepository, 'findAll' | 'upsert'>;
  getFlagRedis?: typeof getFlagRedis;
  flags?: Record<string, FlagDefinition>;
  allFlagKeys?: readonly string[];
  countFlagChecks?: typeof countFlagChecks;
  publishFlagInvalidation?: typeof publishFlagInvalidation;
}

export function createFeatureFlagsRoutes(deps: FeatureFlagsDeps = {}) {
  const {
    log,
    flagRepo = new FeatureFlagRepository(),
    getFlagRedis: getRedis = getFlagRedis,
    flags = FLAGS,
    allFlagKeys = ALL_FLAG_KEYS,
    countFlagChecks: countChecks = countFlagChecks,
    publishFlagInvalidation: publishInvalidation = publishFlagInvalidation,
  } = deps;

  const app = new Hono<AuthEnv>();
  // Protege tanto o GET quanto o PATCH (mais simples e seguro).
  app.use('*', sessionAuth());

  // GET /api/admin/feature-flags — lista todas as flags com status
  app.get('/feature-flags', async (c) => {
    try {
      const rows = await flagRepo.findAll();
      const rowsMap = new Map<string, FlagRow>(rows.map((r) => [r.key, r]));

      const list = await Promise.all(
        allFlagKeys.map(async (key) => {
          const def = flags[key]!;
          const row = rowsMap.get(key);
          // countFlagChecks é best-effort — retorna 0 se Redis offline.
          // O redisUrl só interessa se o caller quiser custom (omitido por padrão).
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

      return c.json({ success: true, flags: list });
    } catch (err) {
      log?.error('Erro ao listar feature flags', { error: String(err) });
      return c.json({ success: false, error: 'Erro interno' });
    }
  });

  // PATCH /api/admin/feature-flags/:key — altera o estado de uma flag
  app.patch('/feature-flags/:key', async (c) => {
    const key = c.req.param('key');
    const body = (await c.req.json().catch(() => ({}))) as { enabled?: unknown };

    if (typeof body.enabled !== 'boolean') {
      return c.json({ success: false, error: 'campo "enabled" deve ser boolean' });
    }

    if (!allFlagKeys.includes(key)) {
      return c.json({ success: false, error: `Flag desconhecida: ${key}` });
    }

    try {
      const row = await flagRepo.upsert(key, body.enabled, 'admin');
      // Best-effort: invalidar cache do cliente + propagar via PubSub.
      // Falha aqui não bloqueia o response (UI já recebeu o estado novo).
      publishInvalidation(key);
      // Força avaliação pós-update chamando getFlagRedis (no-op se já estiver conectado)
      getRedis();
      return c.json({
        success: true,
        flag: {
          key,
          enabled: row.enabled,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt?.toISOString() ?? null,
        },
      });
    } catch (err) {
      log?.error('Erro ao atualizar feature flag', { error: String(err) });
      return c.json({ success: false, error: 'Erro interno' });
    }
  });

  return app;
}
