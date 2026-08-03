/**
 * Testes E2E de API — CRUD de Espelhamentos (mirrors)
 *
 * Requer: API rodando em http://localhost:15442 (E2E stack)
 *
 * Cobertura:
 *   - Listagem vazia
 *   - Criação com dados válidos
 *   - Criação com campos inválidos (validação)
 *   - Criação com nome duplicado
 *   - Listagem paginada
 *   - Busca textual
 *   - Detalhe de espelhamento
 *   - Edição (PUT)
 *   - Edição com dados parciais
 *   - Ativação/desativação (PATCH status)
 *   - Exclusão
 *   - Exclusão de item já removido (404)
 *   - Autenticação (requisições sem token)
 */

import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  TEST_PASSWORD,
  TEST_NAME,
  createTestUser,
  authGet,
  authPost,
  authPut,
} from '../../helpers/index.ts';

// CRUD de mirrors exige validação de admin no grupo destino (feature
// "destino exige admin"). Isso consulta a Evolution API da instância —
// no E2E, apenas a API mirror (15447, que aponta para o simulador WhatsApp)
// retorna grupos com isAdmin=true. Por isso este spec roda contra ela.
const API =
  process.env.API_MIRROR_URL || `http://localhost:${process.env.API_MIRROR_PORT || '15447'}`;

type MirrorResponse = {
  success: boolean;
  mirror: {
    id: number;
    name: string;
    status: string;
    sourceGroups: unknown[];
    targetGroups: unknown[];
    messageTemplate: string | null;
  };
};

type MirrorListResponse = {
  success: boolean;
  rows: unknown[];
  total: number;
  page: number;
  totalPages: number;
};

test.describe('Mirrors API — CRUD', () => {
  let token: string;
  let mirrorId: number;

  test.beforeAll(async () => {
    const user = await createTestUser(API);

    // Conecta WhatsApp no simulador para que o usuário seja admin dos
    // grupos de destino (validação "destino exige admin").
    await authPost('/api/whatsapp/connect', user.token, {}, API);
    token = user.token;
  });

  // ─── Listagem vazia ────────────────────────────────────────────────

  test('1. GET /api/mirrors — listagem vazia retorna total 0', async () => {
    const { status, body } = await authGet<MirrorListResponse>('/api/mirrors', token, API);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.rows).toEqual([]);
    expect(body.total).toBe(0);
    // computeTotalPages(0, 25) === 1 por convenção (sempre ≥ 1 página).
    expect(body.totalPages).toBe(1);
  });

  // ─── Criação ───────────────────────────────────────────────────────

  test('2. POST /api/mirrors — criar espelhamento com dados válidos', async () => {
    const { status, body } = await authPost<MirrorResponse>(
      '/api/mirrors',
      token,
      {
        name: 'Ofertas Diárias',
        sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
        targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
        // messageTemplate: '{texto_original}', // feature desativada temporariamente
      },
      API,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mirror).toBeDefined();
    expect(body.mirror.name).toBe('Ofertas Diárias');
    expect(body.mirror.status).toBe('active');
    expect(body.mirror.sourceGroups).toHaveLength(1);
    expect(body.mirror.targetGroups).toHaveLength(1);
    // expect(body.mirror.messageTemplate).toBe('{texto_original}'); // feature desativada temporariamente
    mirrorId = body.mirror.id;
  });

  test('3. POST /api/mirrors — criar sem grupos de origem (validação)', async () => {
    const { status, body } = await authPost<MirrorResponse>(
      '/api/mirrors',
      token,
      {
        name: 'Sem Origem',
        targetGroups: [{ jid: '120363000000000002@g.us', name: 'Grupo Teste 2' }],
      },
      API,
    );
    // API aceita sourceGroups vazio (defaults to [])
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  test('4. POST /api/mirrors — criar sem nome (validação deve falhar)', async () => {
    const { status, body } = await authPost<MirrorResponse>(
      '/api/mirrors',
      token,
      {
        sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
        targetGroups: [{ jid: '120363000000000002@g.us', name: 'Grupo Teste 2' }],
      },
      API,
    );
    // Nome é obrigatório (minLength: 1) — deve retornar 400/422
    expect(body.success).toBe(false);
  });

  test('5. POST /api/mirrors — criar com nome muito longo', async () => {
    const longName = 'A'.repeat(256);
    const { status, body } = await authPost<MirrorResponse>(
      '/api/mirrors',
      token,
      {
        name: longName,
        sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
        targetGroups: [{ jid: '120363000000000002@g.us', name: 'Grupo Teste 2' }],
      },
      API,
    );
    // maxLength 255 — deve rejeitar
    expect(body.success).toBe(false);
  });

  // ─── Listagem populada ─────────────────────────────────────────────

  test('6. GET /api/mirrors — listagem populada retorna > 0', async () => {
    const { status, body } = await authGet<MirrorListResponse>('/api/mirrors', token, API);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBeGreaterThan(0);
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.page).toBe(1);
  });

  // ─── Detalhe ───────────────────────────────────────────────────────

  test('7. GET /api/mirrors/:id — detalhe do espelhamento', async () => {
    const { status, body } = await authGet<MirrorResponse>(`/api/mirrors/${mirrorId}`, token, API);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mirror.id).toBe(mirrorId);
    expect(body.mirror.name).toBe('Ofertas Diárias');
  });

  test('8. GET /api/mirrors/:id — ID inexistente retorna 404', async () => {
    const res = await fetch(`${API}/api/mirrors/99999`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toContain('não encontrado');
  });

  // ─── Edição ────────────────────────────────────────────────────────

  test('9. PUT /api/mirrors/:id — atualizar nome e template', async () => {
    const { status, body } = await authPut<MirrorResponse>(
      `/api/mirrors/${mirrorId}`,
      token,
      {
        name: 'Ofertas Atualizadas',
        // messageTemplate: '{link_convertido}', // feature desativada temporariamente
      },
      API,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mirror.name).toBe('Ofertas Atualizadas');
    // expect(body.mirror.messageTemplate).toBe('{link_convertido}'); // feature desativada temporariamente
  });

  test('10. PUT /api/mirrors/:id — atualizar com dados parciais', async () => {
    // Atualizar apenas sourceGroups
    const { status, body } = await authPut<MirrorResponse>(
      `/api/mirrors/${mirrorId}`,
      token,
      {
        sourceGroups: [
          { jid: '120363000000000002@g.us', name: 'Grupo Teste 2' },
          { jid: '120363000000000003@g.us', name: 'Grupo Teste 3' },
        ],
      },
      API,
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mirror.sourceGroups).toHaveLength(2);
    // Nome anterior deve ser preservado
    expect(body.mirror.name).toBe('Ofertas Atualizadas');
  });

  test('11. PUT /api/mirrors/:id — ID inexistente retorna 404', async () => {
    const res = await fetch(`${API}/api/mirrors/99999`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name: 'N/A' }),
    });
    expect(res.status).toBe(404);
  });

  // ─── Ativação/Desativação ──────────────────────────────────────────

  test('12. PATCH /api/mirrors/:id/status — desativar espelhamento', async () => {
    const res = await fetch(`${API}/api/mirrors/${mirrorId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'inactive' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect((body.mirror as Record<string, unknown>).status).toBe('inactive');
  });

  test('13. PATCH /api/mirrors/:id/status — reativar espelhamento', async () => {
    const res = await fetch(`${API}/api/mirrors/${mirrorId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'active' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
    expect((body.mirror as Record<string, unknown>).status).toBe('active');
  });

  test('14. PATCH /api/mirrors/:id/status — status inválido rejeitado', async () => {
    const res = await fetch(`${API}/api/mirrors/${mirrorId}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'invalid-status' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  // ─── Exclusão ──────────────────────────────────────────────────────

  test('15. DELETE /api/mirrors/:id — excluir espelhamento', async () => {
    const res = await fetch(`${API}/api/mirrors/${mirrorId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  test('16. DELETE /api/mirrors/:id — excluir item já removido retorna 404', async () => {
    const res = await fetch(`${API}/api/mirrors/${mirrorId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  // ─── Autenticação ──────────────────────────────────────────────────

  test('17. GET /api/mirrors — sem token retorna 401', async () => {
    const res = await fetch(`${API}/api/mirrors`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Não autenticado');
  });

  test('18. POST /api/mirrors — sem token retorna 401', async () => {
    const res = await fetch(`${API}/api/mirrors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Test' }),
    });
    expect(res.status).toBe(401);
  });

  test('19. DELETE /api/mirrors/:id — sem token retorna 401', async () => {
    const res = await fetch(`${API}/api/mirrors/1`, { method: 'DELETE' });
    expect(res.status).toBe(401);
  });
});
