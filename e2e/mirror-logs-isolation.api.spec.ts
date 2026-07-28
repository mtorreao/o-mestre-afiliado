/**
 * Testes E2E — Isolamento multi-tenant dos logs de espelhamento.
 *
 * Cenário coberto (regressão do bug "usuário vê logs de outro usuário"):
 *   1. Cria dois usuários (A e B) e seus respectivos afiliados.
 *   2. Insere logs em reflected_offers — alguns do affiliate A, outros do B.
 *   3. GET /api/affiliate/mirror-logs com token de A → só retorna logs de A.
 *   4. GET /api/affiliate/mirror-logs com token de B → só retorna logs de B.
 *   5. Usuário sem afiliado vinculado → retorna lista vazia (sem vazar dados).
 *
 * O Postgres E2E (omestre_e2e_postgres) é compartilhado entre os containers
 * de API, então os INSERTs via `docker exec psql` ficam visíveis para a rota.
 */

import { test, expect } from '@playwright/test';
import { createTestUser, uniqueEmail, TEST_PASSWORD, TEST_NAME, authGet } from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;
const PG_CONTAINER = 'omestre_e2e_postgres';

// Import dinâmico para manter ESM (igual aos outros specs do repo).
const { execSync } = await import('node:child_process');

/** Executa SQL no Postgres E2E via docker exec. */
function psql(sql: string): void {
  execSync(
    `docker exec ${PG_CONTAINER} psql -U evolution -d omestre_db -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { stdio: 'pipe' } as any,
  );
}

/** Retorna o id do affiliate recém-criado para o instanceName informado. */
function insertAffiliate(instanceName: string, name: string): number {
  const out = execSync(
    `docker exec ${PG_CONTAINER} psql -U evolution -d omestre_db -t -A ` +
      `-c "INSERT INTO omestre.affiliates (name, active, evolution_instance_id) ` +
      `VALUES ('${name}', true, '${instanceName}') ` +
      `ON CONFLICT (evolution_instance_id) DO UPDATE SET name = EXCLUDED.name ` +
      `RETURNING id"`,
    { stdio: 'pipe' } as any,
  )
    .toString()
    .trim();
  const id = parseInt(out, 10);
  if (Number.isNaN(id)) {
    throw new Error(`Falha ao inserir affiliate (instanceName=${instanceName}): "${out}"`);
  }
  return id;
}

/** Insere um log em reflected_offers para o affiliate informado. */
function insertReflectedOffer(opts: {
  affiliateId: number;
  sourceGroupJid: string;
  targetGroupJid: string;
  originalLink: string;
  convertedLink: string;
  marketplace: string;
  status: string;
  marker: string;
}): void {
  psql(
    `INSERT INTO omestre.reflected_offers ` +
      `(affiliate_id, source_group_jid, target_group_jid, original_link, converted_link, marketplace, message_preview, reflected_at, status) ` +
      `VALUES (${opts.affiliateId}, '${opts.sourceGroupJid}', '${opts.targetGroupJid}', ` +
      `'${opts.originalLink}', '${opts.convertedLink}', '${opts.marketplace}', '${opts.marker}', now(), '${opts.status}')`,
  );
}

/** Limpa dados de teste criados por este spec. */
function cleanup(instanceNames: string[], markers: string[]): void {
  const markerList = markers.map((m) => `'${m}'`).join(', ');
  const instanceList = instanceNames.map((i) => `'${i}'`).join(', ');
  psql(
    `DELETE FROM omestre.reflected_offers WHERE message_preview IN (${markerList}); ` +
      `DELETE FROM omestre.affiliates WHERE evolution_instance_id IN (${instanceList});`,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Mirror Logs — Isolamento multi-tenant', () => {
  // Marcadores únicos para identificar os logs deste teste e limpá-los depois.
  const markers = {
    a: `e2e-iso-A-${Date.now()}`,
    b: `e2e-iso-B-${Date.now()}`,
  };
  const instanceNoAffiliate = `user-iso-none-${Date.now()}`;

  let tokenA: string;
  let tokenB: string;
  let tokenNoAffiliate: string;
  let affiliateUserIdA = 0;
  let affiliateUserIdB = 0;

  test.beforeAll(async () => {
    // ── Usuários ──
    const userA = await createTestUser(API);
    const userB = await createTestUser(API);
    // Usuário extra SEM afiliado (apenas para obter o token)
    const resNoAff = await fetch(`${API}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail(), name: TEST_NAME, password: TEST_PASSWORD }),
    });
    const noAffBody = (await resNoAff.json()) as { token: string };

    tokenA = userA.token;
    tokenB = userB.token;
    tokenNoAffiliate = noAffBody.token;
    affiliateUserIdA = userA.user.id;
    affiliateUserIdB = userB.user.id;

    // ── Afiliados ── o vínculo user→affiliate no sistema é `user-<userId>`,
    // então o evolution_instance_id PRECISA bater com instanceNameFromUserId.
    const affiliateIdA = insertAffiliate(`user-${userA.user.id}`, 'E2E Isolamento A');
    const affiliateIdB = insertAffiliate(`user-${userB.user.id}`, 'E2E Isolamento B');

    // ── Logs do usuário A ──
    insertReflectedOffer({
      affiliateId: affiliateIdA,
      sourceGroupJid: '120363000000000001@g.us',
      targetGroupJid: '120363000000000003@g.us',
      originalLink: 'https://shopee.com.br/produto-A',
      convertedLink: 'https://shopee.com.br/produto-A?afiliado',
      marketplace: 'shopee',
      status: 'sent',
      marker: markers.a,
    });
    // ── Logs do usuário B ──
    insertReflectedOffer({
      affiliateId: affiliateIdB,
      sourceGroupJid: '120363000000000001@g.us',
      targetGroupJid: '120363000000000003@g.us',
      originalLink: 'https://shopee.com.br/produto-B',
      convertedLink: 'https://shopee.com.br/produto-B?afiliado',
      marketplace: 'shopee',
      status: 'sent',
      marker: markers.b,
    });
    insertReflectedOffer({
      affiliateId: affiliateIdB,
      sourceGroupJid: '120363000000000001@g.us',
      targetGroupJid: '120363000000000003@g.us',
      originalLink: 'https://mercadolivre.com.br/produto-B2',
      convertedLink: 'https://mercadolivre.com.br/produto-B2?meli',
      marketplace: 'mercadolivre',
      status: 'failed',
      marker: markers.b,
    });
  });

  test.afterAll(() => {
    cleanup(
      [`user-${affiliateUserIdA}`, `user-${affiliateUserIdB}`, instanceNoAffiliate],
      [markers.a, markers.b],
    );
  });

  test('usuário A só enxerga seus próprios logs (não vaza logs de B)', async () => {
    const { status, body } = await authGet(
      '/api/affiliate/mirror-logs?page=1&pageSize=50',
      tokenA,
      API,
    );
    expect(status).toBe(200);
    const data = body as {
      success: boolean;
      rows: Array<{ originalLink: string; convertedLink: string }>;
      total: number;
    };
    expect(data.success).toBe(true);

    // Só pode haver 1 log de A (marcado com markers.a)
    expect(data.total).toBe(1);
    expect(data.rows).toHaveLength(1);
    expect(data.rows[0]!.originalLink).toContain('produto-A');

    // Nenhum log de B deve aparecer
    const vazou = data.rows.some(
      (r) => r.originalLink.includes('produto-B') || r.convertedLink.includes('produto-B'),
    );
    expect(vazou).toBe(false);
  });

  test('usuário B enxerga seus logs (2) e não vê os de A', async () => {
    const { status, body } = await authGet(
      '/api/affiliate/mirror-logs?page=1&pageSize=50',
      tokenB,
      API,
    );
    expect(status).toBe(200);
    const data = body as {
      success: boolean;
      rows: Array<{ originalLink: string }>;
      total: number;
    };
    expect(data.success).toBe(true);

    expect(data.total).toBe(2);
    expect(data.rows).toHaveLength(2);

    // Todos os logs de B contêm "produto-B"
    for (const row of data.rows) {
      expect(row.originalLink).toContain('produto-B');
    }

    // Nenhum log de A
    const vazou = data.rows.some((r) => r.originalLink.includes('produto-A'));
    expect(vazou).toBe(false);
  });

  test('usuário sem afiliado vinculado recebe lista vazia (sem vazar dados alheios)', async () => {
    const { status, body } = await authGet(
      '/api/affiliate/mirror-logs?page=1&pageSize=50',
      tokenNoAffiliate,
      API,
    );
    expect(status).toBe(200);
    const data = body as {
      success: boolean;
      rows: unknown[];
      total: number;
    };
    expect(data.success).toBe(true);
    expect(data.total).toBe(0);
    expect(data.rows).toEqual([]);
  });

  test('filtro de marketplace respeita o isolamento (B filtrando mercadolivre)', async () => {
    const { status, body } = await authGet(
      '/api/affiliate/mirror-logs?page=1&pageSize=50&marketplace=mercadolivre',
      tokenB,
      API,
    );
    expect(status).toBe(200);
    const data = body as {
      success: boolean;
      rows: Array<{ marketplace: string }>;
      total: number;
    };
    expect(data.success).toBe(true);
    expect(data.total).toBe(1);
    expect(data.rows[0]!.marketplace).toBe('mercadolivre');
  });
});
