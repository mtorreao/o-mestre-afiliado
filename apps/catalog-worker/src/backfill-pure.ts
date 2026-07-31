/**
 * backfill-pure — Lógica pura do backfill de catálogo.
 *
 * O backfill varre `reflected_offers` existentes e publica um CatalogJob
 * na Queue C para cada `original_link` normalizável, populando o histórico
 * de preços de imediato (especificação docs/plans/historico-precos.md §5.6).
 *
 * Funções PURAS (sem I/O) — o esqueleto de DB/Redis vive em backfill.ts.
 */
import type { PublishCatalogJobParams } from '@omestre/worker-common';
import { parseAffiliateUserId, resolveCatalogTarget } from '@omestre/shared';

/** Prefisso do messageId fabricado para jobs de backfill (rastreabilidade). */
export const BACKFILL_MESSAGE_PREFIX = 'backfill:';

/** Tamanho do lote de leitura de reflected_offers (keyset pagination). */
export const BACKFILL_BATCH_SIZE = 1000;

/** Linha de reflected_offers relevante para o backfill. */
export interface BackfillRowInput {
  /** id da linha em reflected_offers (vira messageId do job) */
  rowId: number;
  /** marketplace da oferta (reflected_offers.marketplace) */
  marketplace: string;
  /** original_link (já resolvido — mesmo valor que o Ingestor grava) */
  originalLink: string;
  /** JID do grupo de origem */
  sourceGroupJid: string;
  /** reflected_at — vira capturedAt do job (preserva o bucket histórico) */
  reflectedAt: Date;
  /** evolution_instance_id do afiliado (null se o afiliado não tem instance) */
  instanceName: string | null;
}

/**
 * Planeja um CatalogJob para uma linha de reflected_offers.
 *
 * Retorna os params prontos para `publishCatalogJob`, ou null quando o
 * original_link não é normalizável (marketplace sem parser / itemId ausente)
 * — nesse caso a oferta fica só no reflected_offers, igual ao Ingestor.
 */
export function planBackfillRow(input: BackfillRowInput): PublishCatalogJobParams | null {
  const target = resolveCatalogTarget(input.marketplace, input.originalLink);
  if (!target) return null;

  return {
    marketplace: target.marketplace,
    resolvedUrl: input.originalLink,
    sourceGroupJid: input.sourceGroupJid,
    messageId: `${BACKFILL_MESSAGE_PREFIX}${input.rowId}`,
    capturedAt: input.reflectedAt.toISOString(),
    userId: input.instanceName ? parseAffiliateUserId(input.instanceName) : null,
  };
}

/** Opções parseadas da CLI. */
export interface BackfillCliOptions {
  /** 0 = sem limite (varre tudo); N = processa no máximo N linhas */
  limit: number;
  /** true = conta sem publicar (nenhum XADD) */
  dryRun: boolean;
}

/**
 * Parse dos args da CLI (`--limit N`, `--dry-run`).
 * Lança Error em flag desconhecida ou valor inválido — o CLI imprime o uso.
 */
export function parseBackfillArgs(argv: string[]): BackfillCliOptions {
  let limit = 0;
  let dryRun = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--limit') {
      const raw = argv[i + 1];
      const n = Number(raw);
      if (raw === undefined || !Number.isInteger(n) || n < 0) {
        throw new Error('--limit precisa de um inteiro >= 0');
      }
      limit = n;
      i += 1;
    } else {
      throw new Error(`Flag desconhecida: ${arg}`);
    }
  }

  return { limit, dryRun };
}
