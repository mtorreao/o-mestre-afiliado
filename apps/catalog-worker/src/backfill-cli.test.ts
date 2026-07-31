/**
 * Testes do CLI do backfill (main em backfill.ts) com mock de módulos —
 * nenhuma conexão real a PostgreSQL/Redis (padrão mock.module do projeto,
 * mesmo de mirrors.repository.test.ts).
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
// Módulo real carregado ANTES do mock — o mock é um superset (spread) com
// getDb/closeDb sobrescritos, para não quebrar outros arquivos de teste que
// importam '@omestre/db' no mesmo processo (bun test não isola por arquivo).
import * as realDb from '@omestre/db';

// ─── Fakes ────────────────────────────────────────────────────────────

type OfferRow = {
  id: number;
  affiliateId: number;
  sourceGroupJid: string;
  originalLink: string;
  marketplace: string;
  reflectedAt: Date;
};

const offerRows: OfferRow[] = [
  {
    id: 1,
    affiliateId: 1,
    sourceGroupJid: '1203630000@g.us',
    originalLink: 'https://shopee.com.br/Capinha-i.123.456',
    marketplace: 'shopee',
    reflectedAt: new Date('2026-07-30T12:00:00.000Z'),
  },
  {
    id: 2,
    affiliateId: 1,
    sourceGroupJid: '1203630000@g.us',
    originalLink: 'https://www.magazineluiza.com.br/x/p/abc',
    marketplace: 'magalu',
    reflectedAt: new Date('2026-07-30T13:00:00.000Z'),
  },
  {
    id: 3,
    affiliateId: 2,
    sourceGroupJid: '1203630001@g.us',
    originalLink: 'https://www.mercadolivre.com.br/MLB12345678901',
    marketplace: 'mercadolivre',
    reflectedAt: new Date('2026-07-30T14:00:00.000Z'),
  },
];

/** Fila de páginas devolvidas por listReflectedOffers (keyset). */
let offerPages: OfferRow[][];

const affiliateRows = [
  { id: 1, evolutionInstanceId: 'user-7' },
  { id: 2, evolutionInstanceId: null },
];

/** Builder thenable + encadeável (como o query builder real do Drizzle). */
function thenableQuery(result: () => unknown): Record<string, unknown> {
  const q: Record<string, unknown> = {
    where: () => q,
    orderBy: () => q,
    limit: async () => result(),
    offset: () => q,
    then: (resolve: (v: unknown) => void) => {
      resolve(result());
    },
  };
  return q;
}

function makeFakeDb() {
  return {
    select: (shape: Record<string, unknown>) => {
      const isAffiliatesQuery = 'evolutionInstanceId' in shape;
      return {
        from: () =>
          isAffiliatesQuery
            ? thenableQuery(() => affiliateRows)
            : thenableQuery(() => offerPages.shift() ?? []),
      };
    },
  };
}

let xaddCalls: string[] = [];
let quitCalls = 0;

function makeFakeRedis() {
  return class FakeRedis {
    constructor(_url: string, _opts?: unknown) {}
    on(_event: string, _cb: (err: Error) => void): void {}
    async xadd(...args: unknown[]): Promise<string> {
      xaddCalls.push(String(args[args.length - 1]));
      return '1720000000000-0';
    }
    async quit(): Promise<void> {
      quitCalls += 1;
    }
  };
}

// ─── Mocks ANTES do import do backfill ────────────────────────────────

await mock.module('@omestre/db', () => ({
  ...realDb,
  getDb: () => makeFakeDb(),
  closeDb: async () => {},
}));

await mock.module('ioredis', () => ({
  default: makeFakeRedis(),
}));

const { main } = await import('./backfill.ts');

// ─── Helpers ──────────────────────────────────────────────────────────

const originalExit = process.exit;
let exitCode: number | null = null;

function captureExit(): void {
  exitCode = null;
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
}

afterEach(() => {
  process.exit = originalExit;
  exitCode = null;
  offerPages = [];
  xaddCalls = [];
  quitCalls = 0;
});

// ─── Testes ───────────────────────────────────────────────────────────

describe('main (CLI do backfill)', () => {
  it('varre reflected_offers e publica CatalogJobs na Queue C', async () => {
    offerPages = [offerRows.slice(0, 2), [offerRows[2]!], []];
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    try {
      await main();
    } finally {
      console.log = originalLog;
    }

    const report = logs.join('\n');
    expect(report).toContain('Linhas varridas: 3');
    expect(report).toContain('Normalizáveis:   2');
    expect(report).toContain('2 publicado(s) na Queue C');
    expect(quitCalls).toBe(1);
    // 2 XADDs (shopee + mercadolivre); magalu não publica
    expect(xaddCalls).toHaveLength(2);
    const job1 = JSON.parse(xaddCalls[0]!) as { messageId: string; userId: number | null };
    expect(job1.messageId).toBe('backfill:1');
    expect(job1.userId).toBe(7);
    const job3 = JSON.parse(xaddCalls[1]!) as { messageId: string; userId: number | null };
    expect(job3.messageId).toBe('backfill:3');
    expect(job3.userId).toBeNull();
  });

  it('--dry-run não publica nada', async () => {
    offerPages = [offerRows.slice(0, 1), []];
    const argv = ['--dry-run'];

    await main(argv);

    expect(xaddCalls).toHaveLength(0);
  });

  it('--limit 1 para após a primeira linha', async () => {
    offerPages = [offerRows.slice(0, 1), []];
    await main(['--limit', '1']);

    expect(xaddCalls).toHaveLength(1);
  });

  it('flag inválida → usage + process.exit(2)', async () => {
    captureExit();
    offerPages = [[]];

    await expect(main(['--bogus'])).rejects.toThrow('process.exit(2)');
    expect(exitCode).toBe(2);
    expect(xaddCalls).toHaveLength(0);
  });
});
