/**
 * Testes do POST /api/affiliate/force-group
 *
 * Valida que o endpoint de ativação forçada de grupos com <70%
 * salva corretamente no banco e cache, mesmo sem validação.
 *
 * Cenários:
 *   1. 401 — sem autenticação
 *   2. 400 — groupJid ou groupName ausentes
 *   3. 200 — ativação forçada de grupo excluído
 *   4. 200 — grupo já está nos sourceGroups
 *   5. 400 — limite de 3 grupos atingido
 *   6. 200 — affiliate sem excludedGroups (adiciona normalmente)
 *   7. 200 — preserve targetGroups existentes
 *   8. 400 — campos vazios
 */

import { describe, it, expect, mock, beforeAll, beforeEach } from 'bun:test';
import { t } from 'elysia';

// ═════════════════════════════════════════════════════════════════════════
// MOCKS — Usando mock.module antes de import dinâmico
// ═════════════════════════════════════════════════════════════════════════

const mockFindByEvolutionInstanceId = mock<(instanceId: string) => Promise<object | null>>();
const mockUpsertGroups = mock<(instanceId: string, data: object) => Promise<object>>();
const mockRemoveExcludedGroup = mock<(instanceId: string, groupJid: string) => Promise<void>>();

mock.module('@omestre/db', () => ({
  AffiliatesRepository: class FakeAffiliatesRepo {
    findByEvolutionInstanceId = mockFindByEvolutionInstanceId;
    upsertGroups = mockUpsertGroups;
    removeExcludedGroup = mockRemoveExcludedGroup;
  },
  UserRepository: class FakeUserRepo {},
  UserCredentialsRepository: class FakeCredRepo {},
  MlAffiliateRepository: class FakeMlRepo {},
  MirrorLogRepository: class FakeMirrorLogRepo {},
  getDb: () => ({}),
}));

// ═════════════════════════════════════════════════════════════════════════
// HELPERS
// ═════════════════════════════════════════════════════════════════════════

const JWT_SECRET = 'omestre-dev-secret-change-in-production';

/**
 * Gera um JWT real usando o mesmo @elysiajs/jwt que a aplicação usa.
 * O token é gerado e verificado com a mesma chave secreta do auth.ts,
 * então o middleware de autenticação aceita naturalmente.
 */
async function createTestToken(): Promise<string> {
  const { jwt } = await import('@elysiajs/jwt');
  const { Elysia } = await import('elysia');

  const app = new Elysia()
    .use(
      jwt({
        name: 'jwt',
        secret: JWT_SECRET,
        schema: t.Object({
          userId: t.Number(),
          userEmail: t.String(),
        }),
      }),
    )
    .get('/sign', ({ jwt: j }: any) => j.sign({ userId: 42, userEmail: 'test@example.com' }));

  const res = await app.handle(new Request('http://localhost/sign'));
  return await res.text();
}

function makeRequest(body: object, token: string | null): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return new Request('http://localhost/api/affiliate/force-group', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function makeAffiliate(overrides: object = {}) {
  return {
    id: 1,
    sourceGroups: [{ jid: 'g1@c.us', name: 'Grupo 1' }],
    targetGroups: [{ jid: 'destino@c.us', name: 'Destino' }],
    excludedGroups: [
      {
        groupJid: 'ruim@c.us',
        groupName: 'Grupo Ruim',
        reason: 'Apenas 30% de ofertas (mínimo 70%)',
        ratio: 0.3,
        totalMessages: 20,
        validOffers: 6,
      },
    ],
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// TESTES
// ═════════════════════════════════════════════════════════════════════════

describe('POST /api/affiliate/force-group', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let authedToken: string;

  async function buildApp() {
    const { Elysia } = await import('elysia');
    const { affiliateRoutes } = await import('../affiliate.routes.ts');
    return new Elysia().use(affiliateRoutes);
  }

  beforeAll(async () => {
    authedToken = await createTestToken();
  });

  beforeEach(async () => {
    app = await buildApp();
    mockFindByEvolutionInstanceId.mockReset();
    mockUpsertGroups.mockReset();
    mockRemoveExcludedGroup.mockReset();
  });

  // ─── 401 — Sem autenticação ──────────────────────────────────────────

  it('retorna 401 quando não autenticado', async () => {
    const res = await app.handle(makeRequest(
      { groupJid: 'test@c.us', groupName: 'Test' },
      null,
    ));
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Não autenticado');
  });

  // ─── 400 — Campos obrigatórios ───────────────────────────────────────

  it.each([
    ['groupJid ausente', {}, 'groupJid'],
    ['groupName ausente', { groupJid: 'test@c.us' }, 'groupName'],
    ['groupJid vazio', { groupJid: '', groupName: 'Test' }, 'groupJid'],
    ['groupName vazio', { groupJid: 'test@c.us', groupName: '' }, 'groupName'],
  ] as [string, Record<string, string>, string][])('retorna 400 quando %s', async (_label, fields, expectedError) => {
    const res = await app.handle(makeRequest(fields, authedToken));
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.success).toBe(false);
    expect(data.error).toContain(expectedError);
  });

  // ─── Afiliado não encontrado ────────────────────────────────────────

  it('retorna erro quando afiliado não existe', async () => {
    mockFindByEvolutionInstanceId.mockResolvedValue(null);

    const res = await app.handle(makeRequest(
      { groupJid: 'test@c.us', groupName: 'Test' },
      authedToken,
    ));
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Afiliado não encontrado');
  });

  // ─── 200 — Ativação forçada bem-sucedida ─────────────────────────────

  it('força ativação de grupo excluído com sucesso', async () => {
    mockFindByEvolutionInstanceId.mockResolvedValue(makeAffiliate());
    mockUpsertGroups.mockResolvedValue({ id: 1 });
    mockRemoveExcludedGroup.mockResolvedValue();

    const res = await app.handle(makeRequest(
      { groupJid: 'ruim@c.us', groupName: 'Grupo Ruim' },
      authedToken,
    ));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.message).toContain('ativado mesmo sem validação');

    // upsertGroups deve ter adicionado o grupo
    expect(mockUpsertGroups).toHaveBeenCalledTimes(1);
    const [instanceId, data] = mockUpsertGroups.mock.calls[0] as [string, any];
    expect(instanceId).toBe('user-42');
    expect(data.sourceGroups).toContainEqual({ jid: 'ruim@c.us', name: 'Grupo Ruim' });
    // Grupos excluídos devem ter o forced group removido
    const forcedRemoved = data.excludedGroups.find(
      (eg: any) => eg.groupJid === 'ruim@c.us',
    );
    expect(forcedRemoved).toBeUndefined();
  });

  // ─── 200 — Grupo já ativo (já nos sourceGroups) ──────────────────────

  it('retorna mensagem informativa quando grupo já está ativo', async () => {
    mockFindByEvolutionInstanceId.mockResolvedValue(
      makeAffiliate({ sourceGroups: [{ jid: 'ruim@c.us', name: 'Grupo Ruim' }] }),
    );

    const res = await app.handle(makeRequest(
      { groupJid: 'ruim@c.us', groupName: 'Grupo Ruim' },
      authedToken,
    ));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.message).toBe('Grupo já está ativo no espelhamento.');

    // Não deve modificar groups se já está lá
    expect(mockUpsertGroups).toHaveBeenCalledTimes(0);
  });

  // ─── 400 — Limite de 3 grupos atingido ───────────────────────────────

  it('retorna erro quando já existem 3 sourceGroups', async () => {
    mockFindByEvolutionInstanceId.mockResolvedValue(
      makeAffiliate({
        sourceGroups: [
          { jid: 'g1@c.us', name: 'G1' },
          { jid: 'g2@c.us', name: 'G2' },
          { jid: 'g3@c.us', name: 'G3' },
        ],
      }),
    );

    const res = await app.handle(makeRequest(
      { groupJid: 'ruim@c.us', groupName: 'Grupo Ruim' },
      authedToken,
    ));
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Limite máximo de 3');
    expect(mockUpsertGroups).toHaveBeenCalledTimes(0);
  });

  // ─── 200 — Afiliado sem excludedGroups ──────────────────────────────

  it('força ativação mesmo sem excludedGroups (grupo novo)', async () => {
    mockFindByEvolutionInstanceId.mockResolvedValue(
      makeAffiliate({ excludedGroups: [] }),
    );
    mockUpsertGroups.mockResolvedValue({ id: 1 });

    const res = await app.handle(makeRequest(
      { groupJid: 'novo@c.us', groupName: 'Grupo Novo' },
      authedToken,
    ));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);

    // Verifica que foi adicionado corretamente
    const [, data] = mockUpsertGroups.mock.calls[0] as [string, any];
    expect(data.sourceGroups).toHaveLength(2);
    expect(data.sourceGroups).toContainEqual({ jid: 'novo@c.us', name: 'Grupo Novo' });
    expect(data.excludedGroups).toEqual([]);
  });

  // ─── 200 — Preserva targetGroups ────────────────────────────────────

  it('preserva targetGroups existentes ao forçar ativação', async () => {
    mockFindByEvolutionInstanceId.mockResolvedValue(
      makeAffiliate({
        targetGroups: [
          { jid: 'd1@c.us', name: 'Destino 1' },
          { jid: 'd2@c.us', name: 'Destino 2' },
        ],
      }),
    );
    mockUpsertGroups.mockResolvedValue({ id: 1 });

    await app.handle(makeRequest(
      { groupJid: 'ruim@c.us', groupName: 'Grupo Ruim' },
      authedToken,
    ));

    const [, data] = mockUpsertGroups.mock.calls[0] as [string, any];
    expect(data.targetGroups).toEqual([
      { jid: 'd1@c.us', name: 'Destino 1' },
      { jid: 'd2@c.us', name: 'Destino 2' },
    ]);
  });

  // ─── 200 — Novo grupo mantém excluded antigos ────────────────────────

  it('mantém excludedGroups de outros grupos ao forçar ativação', async () => {
    mockFindByEvolutionInstanceId.mockResolvedValue(
      makeAffiliate({
        excludedGroups: [
          {
            groupJid: 'ruim@c.us',
            groupName: 'Grupo Ruim',
            reason: 'Apenas 30% de ofertas (mínimo 70%)',
            ratio: 0.3,
            totalMessages: 20,
            validOffers: 6,
          },
          {
            groupJid: 'outro-ruim@c.us',
            groupName: 'Outro Ruim',
            reason: 'Apenas 10% de ofertas (mínimo 70%)',
            ratio: 0.1,
            totalMessages: 10,
            validOffers: 1,
          },
        ],
      }),
    );
    mockUpsertGroups.mockResolvedValue({ id: 1 });

    await app.handle(makeRequest(
      { groupJid: 'ruim@c.us', groupName: 'Grupo Ruim' },
      authedToken,
    ));

    const [, data] = mockUpsertGroups.mock.calls[0] as [string, any];
    // O grupo forçado deve ser removido de excluded
    expect(data.excludedGroups).toHaveLength(1);
    expect(data.excludedGroups[0].groupJid).toBe('outro-ruim@c.us');
    expect(data.excludedGroups[0].groupJid).not.toBe('ruim@c.us');
  });

  // ─── 400 — Token inválido ────────────────────────────────────────────

  it('retorna 401 com token inválido', async () => {
    const res = await app.handle(makeRequest(
      { groupJid: 'test@c.us', groupName: 'Test' },
      'token-invalido',
    ));
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Não autenticado');
  });
});
