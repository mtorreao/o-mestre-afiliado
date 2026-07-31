/**
 * backfill — Backfill do catálogo de preços (roda UMA vez após o deploy).
 *
 * Varre `reflected_offers` existentes e publica um CatalogJob na Queue C
 * (`omestre:mirror:catalog`) para cada `original_link` normalizável — o
 * CatalogWorker processa e grava products / product_variations /
 * price_history (com o bucket histórico de `reflected_at`).
 *
 * Uso (da raiz do repo, carrega o .env):
 *   bun run backfill              # tudo
 *   bun run backfill --limit 500  # só as 500 primeiras linhas
 *   bun run backfill --dry-run    # só conta, não publica
 *
 * Comando EXPLÍCITO — nunca roda automaticamente (especificação §5.6).
 */
import { gt } from 'drizzle-orm';
import Redis from 'ioredis';
import { affiliates, closeDb, getDb, reflectedOffers } from '@omestre/db';
import type { PublishCatalogJobParams } from '@omestre/worker-common';
import { publishCatalogJob } from '@omestre/worker-common';
import { BACKFILL_BATCH_SIZE, parseBackfillArgs, planBackfillRow } from './backfill-pure.ts';
import type { BackfillCliOptions, BackfillRowInput } from './backfill-pure.ts';

// ─── Tipos ────────────────────────────────────────────────────────────

/** Estatísticas agregadas do backfill (retornadas por runBackfill). */
export interface BackfillStats {
  /** Linhas de reflected_offers varridas */
  scanned: number;
  /** Linhas com original_link normalizável (virariam jobs) */
  candidates: number;
  /** CatalogJobs publicados na Queue C */
  published: number;
  /** Publicações que falharam (Redis) */
  failed: number;
  /** true = modo dry-run (nada foi publicado) */
  dryRun: boolean;
  /** Duração total em ms */
  durationMs: number;
}

/** Linha mínima de reflected_offers consumida pelo backfill. */
export interface ReflectedOfferBackfillRow {
  id: number;
  affiliateId: number;
  sourceGroupJid: string;
  originalLink: string;
  marketplace: string;
  reflectedAt: Date;
}

/** Dependências injetáveis (testes usam fakes — zero DB/Redis real). */
export interface BackfillDeps {
  /** Página de reflected_offers com id > afterId (keyset pagination). */
  listReflectedOffers(afterId: number, limit: number): Promise<ReflectedOfferBackfillRow[]>;
  /** Mapa affiliateId → evolution_instance_id (null quando não tem instance). */
  listAffiliateInstanceNames(): Promise<Map<number, string | null>>;
  /** Publica um CatalogJob (XADD na Queue C). */
  publish(params: PublishCatalogJobParams): Promise<boolean>;
}

// ─── Orquestração (loop + stats) ──────────────────────────────────────

export async function runBackfill(
  deps: BackfillDeps,
  opts: { limit: number; dryRun: boolean },
): Promise<BackfillStats> {
  const startedAt = Date.now();
  const stats: BackfillStats = {
    scanned: 0,
    candidates: 0,
    published: 0,
    failed: 0,
    dryRun: opts.dryRun,
    durationMs: 0,
  };

  const instanceNames = await deps.listAffiliateInstanceNames();
  let afterId = 0;
  let batch = await deps.listReflectedOffers(afterId, BACKFILL_BATCH_SIZE);

  while (batch.length > 0) {
    for (const row of batch) {
      if (opts.limit > 0 && stats.scanned >= opts.limit) break;
      stats.scanned += 1;

      const input: BackfillRowInput = {
        rowId: row.id,
        marketplace: row.marketplace,
        originalLink: row.originalLink,
        sourceGroupJid: row.sourceGroupJid,
        reflectedAt: row.reflectedAt,
        instanceName: instanceNames.get(row.affiliateId) ?? null,
      };
      const params = planBackfillRow(input);
      if (!params) continue; // não normalizável → fica só no reflected_offers

      stats.candidates += 1;
      if (opts.dryRun) continue;

      try {
        if (await deps.publish(params)) {
          stats.published += 1;
        } else {
          stats.failed += 1;
        }
      } catch {
        stats.failed += 1;
      }
    }

    if (opts.limit > 0 && stats.scanned >= opts.limit) break;

    const last = batch[batch.length - 1];
    if (!last) break;
    afterId = last.id;
    batch = await deps.listReflectedOffers(afterId, BACKFILL_BATCH_SIZE);
  }

  stats.durationMs = Date.now() - startedAt;
  return stats;
}

/** Relatório de fim de execução (formato CLI do projeto). */
export function summarizeBackfill(stats: BackfillStats): string {
  const mode = stats.dryRun
    ? 'dry-run (nada foi publicado)'
    : `${stats.published} publicado(s) na Queue C`;
  return [
    '📦 Backfill de catálogo concluído',
    `   Modo:            ${mode}`,
    `   Linhas varridas: ${stats.scanned}`,
    `   Normalizáveis:   ${stats.candidates}`,
    `   Falhas:          ${stats.failed}`,
    `   Duração:         ${stats.durationMs}ms`,
  ].join('\n');
}

// ─── CLI ──────────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:5455';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let opts: BackfillCliOptions;
  try {
    opts = parseBackfillArgs(argv);
  } catch (err) {
    console.error('❌ ' + (err instanceof Error ? err.message : String(err)));
    console.error('Uso: bun run backfill [--limit N] [--dry-run]');
    process.exit(2);
  }

  const db = getDb();
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 200, 5000);
    },
  });
  redis.on('error', (err) => {
    console.error('⚠️ Redis: ' + err.message);
  });

  const deps: BackfillDeps = {
    listReflectedOffers: (afterId, limit) =>
      db
        .select({
          id: reflectedOffers.id,
          affiliateId: reflectedOffers.affiliateId,
          sourceGroupJid: reflectedOffers.sourceGroupJid,
          originalLink: reflectedOffers.originalLink,
          marketplace: reflectedOffers.marketplace,
          reflectedAt: reflectedOffers.reflectedAt,
        })
        .from(reflectedOffers)
        .where(gt(reflectedOffers.id, afterId))
        .orderBy(reflectedOffers.id)
        .limit(limit),
    listAffiliateInstanceNames: async () => {
      const rows = await db
        .select({
          id: affiliates.id,
          evolutionInstanceId: affiliates.evolutionInstanceId,
        })
        .from(affiliates);
      return new Map(rows.map((row) => [row.id, row.evolutionInstanceId]));
    },
    publish: (params) => publishCatalogJob(params, redis),
  };

  console.log('📦 Backfill de catálogo — varrendo reflected_offers...');
  const stats = await runBackfill(deps, { limit: opts.limit, dryRun: opts.dryRun });
  console.log(summarizeBackfill(stats));

  await closeDb();
  await redis.quit();
}

// Só executa como entrypoint (bun run backfill) — testes importam o módulo
// para cobrir runBackfill sem disparar conexão real com DB/Redis.
if (import.meta.main) {
  main().catch((err) => {
    console.error('❌ Backfill falhou: ' + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
}
