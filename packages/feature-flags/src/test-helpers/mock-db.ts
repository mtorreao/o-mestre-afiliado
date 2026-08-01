import { mock } from 'bun:test';

/**
 * Configuração centralizada do mock do @omestre/db usado pelos testes de
 * client.ts. Exporta o estado mutável (mockDb) e as funções para reset.
 *
 * O mock é carregado UMA vez por processo via `mock.module('@omestre/db')`
 * no entrypoint de testes. Aqui só definimos as funções que retornam os
 * mocks — para que `client.ts` receba sempre o mesmo objeto mockado.
 */

export interface MockFindByKeyRow {
  key: string;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface MockDbHandle {
  findByKey: ReturnType<typeof mock<(...args: any[]) => Promise<MockFindByKeyRow | null>>>;
  findAll: ReturnType<typeof mock<(...args: any[]) => Promise<MockFindByKeyRow[]>>>;
  upsert: ReturnType<typeof mock<(...args: any[]) => Promise<MockFindByKeyRow>>>;
  reset: () => void;
}

let _handle: MockDbHandle | null = null;

export function getMockDb(): MockDbHandle {
  if (_handle) return _handle;
  const findByKey = mock<(...args: any[]) => Promise<MockFindByKeyRow | null>>(() =>
    Promise.resolve(null),
  );
  const findAll = mock<(...args: any[]) => Promise<MockFindByKeyRow[]>>(() => Promise.resolve([]));
  const upsert = mock<(...args: any[]) => Promise<MockFindByKeyRow>>(() =>
    Promise.resolve({
      key: 'test',
      enabled: true,
      updatedBy: null,
      updatedAt: new Date(),
    }),
  );
  _handle = {
    findByKey,
    findAll,
    upsert,
    reset: () => {
      findByKey.mockReset();
      findByKey.mockReturnValue(Promise.resolve(null));
      findAll.mockReset();
      findAll.mockReturnValue(Promise.resolve([]));
      upsert.mockReset();
      upsert.mockReturnValue(
        Promise.resolve({
          key: 'test',
          enabled: true,
          updatedBy: null,
          updatedAt: new Date(),
        }),
      );
    },
  };
  return _handle;
}

/**
 * Registra o mock no module loader do Bun. Deve ser chamado ANTES de
 * qualquer `import './client'`.
 */
export function installDbMock(): void {
  const db = getMockDb();
  mock.module('@omestre/db', () => ({
    FeatureFlagRepository: mock(() => ({
      findByKey: db.findByKey,
      findAll: db.findAll,
      upsert: db.upsert,
    })),
  }));
}
