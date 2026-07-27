/**
 * Testes do MirrorLogRepository com mock de getDb (sem PostgreSQL real).
 *
 * O mock substitui `getDb()` por um fake Drizzle client que expõe
 * select com `.from().where().orderBy().limit().offset()` encadeáveis
 * e retornam dados controlados — suficiente para testar a lógica de
 * paginação, filtros e demais consultas do repositório sem conexão externa.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';

/**
 * Cria um resultado de query encadeável.
 * - todas as funções de encadeamento (where, orderBy, limit, offset, groupBy)
 *   retornam o próprio chain
 * - o chain é também uma thenable (tem .then), permitindo `await` direto
 *   de qualquer ponto da cadeia
 */
function makeChain(result: unknown[]) {
  const chain: any = {
    then: (resolve: (v: unknown) => void) => resolve(result),
    where: (): typeof chain => chain,
    orderBy: (): typeof chain => chain,
    limit: (): typeof chain => chain,
    offset: (): typeof chain => chain,
    groupBy: (): typeof chain => chain,
  };
  return chain;
}

/**
 * Cria um fake Db client com valores padrão que podem ser sobrescritos.
 */
function fakeDb(
  over: Partial<{
    select: (...args: unknown[]) => { from: (t: unknown) => ReturnType<typeof makeChain> };
  }> = {},
) {
  return {
    select: over.select ?? (() => ({ from: () => makeChain([]) })),
  };
}

// Mock getDb ANTES de importar o repositório
await mock.module('../db.ts', () => ({
  getDb: () => fakeDb(),
}));

const { MirrorLogRepository } = await import('./mirrorLog.repository.ts');
const repo = new MirrorLogRepository();

describe('MirrorLogRepository', () => {
  afterEach(() => {
    mock.module('../db.ts', () => ({
      getDb: () => fakeDb(),
    }));
  });

  describe('list', () => {
    it('usa defaults de paginação quando sem filtros', async () => {
      const result = await repo.list({});
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(result.rows).toEqual([]);
    });

    it('aplica filtro de status', async () => {
      // Precisamos mockar select para retornar {total: 5} no count e [] nos dados
      let selectCallCount = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => {
              selectCallCount++;
              return {
                from: () =>
                  makeChain(
                    // 1ª chamada = count
                    selectCallCount === 1 ? [{ total: 5 }] : [],
                  ),
              };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ status: 'failed' });
      expect(r.total).toBe(5);
      expect(r.page).toBe(1);
      expect(r.pageSize).toBe(25);
      // select foi chamado pelo menos 2x (count + data)
      expect(selectCallCount).toBeGreaterThanOrEqual(2);
    });

    it('aplica filtro de marketplace', async () => {
      let callIdx = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => {
              callIdx++;
              return { from: () => makeChain(callIdx === 1 ? [{ total: 3 }] : []) };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ marketplace: 'shopee' });
      expect(r.total).toBe(3);
      expect(r.rows).toEqual([]);
    });

    it('aplica filtro dateFrom/dateTo', async () => {
      let callIdx = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => {
              callIdx++;
              return { from: () => makeChain(callIdx === 1 ? [{ total: 2 }] : []) };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ dateFrom: '2024-01-01', dateTo: '2024-12-31' });
      expect(r.total).toBe(2);
    });

    it('aplica filtro sourceGroupJid', async () => {
      let callIdx = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => {
              callIdx++;
              return { from: () => makeChain(callIdx === 1 ? [{ total: 1 }] : []) };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ sourceGroupJid: 'group@jid' });
      expect(r.total).toBe(1);
    });

    it('aplica filtro targetGroupJid', async () => {
      let callIdx = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => {
              callIdx++;
              return { from: () => makeChain(callIdx === 1 ? [{ total: 1 }] : []) };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ targetGroupJid: 'target@jid' });
      expect(r.total).toBe(1);
    });

    it('lida com search (busca textual)', async () => {
      // Com search, o repo faz 3 selects: mirrors (busca JIDs), count, dados
      let callIdx = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => {
              callIdx++;
              return {
                from: () =>
                  makeChain(
                    callIdx === 1
                      ? [
                          {
                            id: 1,
                            sourceGroups: [{ jid: 'src@jid', name: 'Grupo Teste' }],
                            targetGroups: [],
                          },
                        ]
                      : callIdx === 2
                        ? [{ total: 1 }]
                        : [],
                  ),
              };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ search: 'teste' });
      expect(r.total).toBe(1);
      expect(callIdx).toBeGreaterThanOrEqual(3);
    });

    it('lida com search sem match em grupos', async () => {
      let callIdx = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => {
              callIdx++;
              return {
                from: () =>
                  makeChain(
                    callIdx === 1
                      ? [{ id: 1, sourceGroups: [], targetGroups: [] }]
                      : callIdx === 2
                        ? [{ total: 0 }]
                        : [],
                  ),
              };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ search: 'xyz' });
      expect(r.total).toBe(0);
    });

    it('retorna dados paginados', async () => {
      const fakeRows = [
        {
          id: 1,
          affiliateId: 10,
          sourceGroupJid: 'src@jid',
          targetGroupJid: 'tgt@jid',
          originalLink: 'https://ex.com',
          convertedLink: 'https://conv.com',
          marketplace: 'shopee',
          messagePreview: 'oferta',
          reflectedAt: new Date(),
          status: 'sent',
          failureReason: null,
        },
      ];
      let callIdx = 0;
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: (fields?: unknown) => {
              callIdx++;
              const hasTotal =
                fields &&
                typeof fields === 'object' &&
                'total' in (fields as Record<string, unknown>);
              return {
                from: () =>
                  makeChain(
                    callIdx === 1 && hasTotal ? [{ total: 1 }] : callIdx === 2 ? fakeRows : [],
                  ),
              };
            },
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().list({ page: 1, pageSize: 10 });
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]!.id).toBe(1);
      expect(r.total).toBe(1);
      expect(r.page).toBe(1);
      expect(r.pageSize).toBe(10);
    });
  });

  describe('listSourceGroupJids', () => {
    it('retorna lista de JIDs', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({ from: () => makeChain([{ jid: 'src1@jid' }, { jid: 'src2@jid' }]) }),
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().listSourceGroupJids();
      expect(r).toEqual(['src1@jid', 'src2@jid']);
    });

    it('retorna array vazio quando sem dados', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({ from: () => makeChain([]) }),
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().listSourceGroupJids();
      expect(r).toEqual([]);
    });
  });

  describe('listTargetGroupJids', () => {
    it('retorna lista de JIDs', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({ from: () => makeChain([{ jid: 'tgt1@jid' }, { jid: 'tgt2@jid' }]) }),
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().listTargetGroupJids();
      expect(r).toEqual(['tgt1@jid', 'tgt2@jid']);
    });
  });

  describe('listMarketplaces', () => {
    it('retorna lista de marketplaces', async () => {
      mock.module('../db.ts', () => ({
        getDb: () =>
          fakeDb({
            select: () => ({
              from: () => makeChain([{ marketplace: 'shopee' }, { marketplace: 'mercadolivre' }]),
            }),
          }),
      }));
      const { MirrorLogRepository: MR } = await import('./mirrorLog.repository.ts');
      const r = await new MR().listMarketplaces();
      expect(r).toEqual(['shopee', 'mercadolivre']);
    });
  });
});
