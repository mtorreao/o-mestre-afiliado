/**
 * Testes E2E de API — Grupos WhatsApp e configuração de espelhamento.
 *
 * Fluxo completo:
 *   1. GET  /api/whatsapp/groups             — listar grupos (requer conexão)
 *   2. POST /api/affiliate/validate-groups   — validar grupos de ofertas
 *   3. POST /api/affiliate/groups-config     — salvar configuração
 *
 * Requer: API rodando em http://localhost:15442 (E2E stack)
 *         Evolution API rodando em http://localhost:15444
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
} from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Faz uma requisição DELETE autenticada.
 */
async function authDelete(path: string, token: string, baseUrl = API) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Cria um usuário e já conecta WhatsApp (retorna QR code).
 * Útil para testes que dependem de instância ativa.
 */
async function createUserWithInstance(): Promise<{
  token: string;
  user: { id: number; email: string; name: string };
}> {
  const { token, user } = await createTestUser();
  // Conecta WhatsApp — pode falhar se Evolution não retornar QR,
  // mas ao menos a instância fica registrada no banco
  const { status } = await authPost('/api/whatsapp/connect', token, {});
  if (status !== 200) {
    // Se não conseguiu criar, ainda assim o usuário existe para testar
    // o fluxo de erro "WhatsApp não conectado"
  }
  return { token, user };
}

// ─── Auth ─────────────────────────────────────────────────────────────

test.describe('WhatsApp Groups - Auth', () => {
  test('GET /api/whatsapp/groups deve retornar 401 sem token', async () => {
    const res = await fetch(`${API}/api/whatsapp/groups`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });

  test('POST /api/affiliate/validate-groups deve retornar 401 sem token', async () => {
    const res = await fetch(`${API}/api/affiliate/validate-groups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceGroups: [] }),
    });
    expect(res.status).toBe(401);
  });

  test('POST /api/affiliate/groups-config deve retornar 401 sem token', async () => {
    const res = await fetch(`${API}/api/affiliate/groups-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceGroups: [], targetGroup: {} }),
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/whatsapp/groups ─────────────────────────────────────────

test.describe('WhatsApp Groups - Listagem', () => {
  test('GET /api/whatsapp/groups deve retornar erro se não estiver conectado', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authGet('/api/whatsapp/groups', token);
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('WhatsApp não está conectado');
  });

  test('GET /api/whatsapp/groups deve retornar 401 com token inválido', async () => {
    const res = await fetch(`${API}/api/whatsapp/groups`, {
      headers: { Authorization: 'Bearer invalid-token-here' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/affiliate/validate-groups ──────────────────────────────

test.describe('Affiliate - Validar Grupos de Ofertas', () => {
  test('deve rejeitar lista vazia de grupos', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authPost(
      '/api/affiliate/validate-groups',
      token,
      { sourceGroups: [] },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Selecione pelo menos 1');
  });

  test('deve rejeitar mais de 3 grupos', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authPost(
      '/api/affiliate/validate-groups',
      token,
      {
        sourceGroups: [
          { jid: '1@g.us', name: 'Grupo 1' },
          { jid: '2@g.us', name: 'Grupo 2' },
          { jid: '3@g.us', name: 'Grupo 3' },
          { jid: '4@g.us', name: 'Grupo 4' },
        ],
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Máximo de 3');
  });

  test('deve validar 1 grupo com formato correto', async () => {
    const { token } = await createTestUser();

    // Com instância ativa ou não, o endpoint deve processar a requisição
    // (o resultado da validação depende da Evolution, mas a API deve responder)
    const { status, body } = await authPost(
      '/api/affiliate/validate-groups',
      token,
      {
        sourceGroups: [
          { jid: '120363123456789@g.us', name: 'Ofertas Teste' },
        ],
      },
    );
    // O endpoint sempre retorna 200 com success=true mesmo quando
    // a validação falha — o resultado está no campo "validated"
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.validated).toBeDefined();
    expect(body.report).toBeDefined();
    expect(body.report.groups).toBeInstanceOf(Array);
    expect(body.report.groups.length).toBe(1);
  });

  test('deve validar caso sem instância WhatsApp — retorna erros por grupo', async () => {
    const { token } = await createTestUser();

    // Usuário sem WhatsApp conectado — a Evolution não tem a instância
    const { status, body } = await authPost(
      '/api/affiliate/validate-groups',
      token,
      {
        sourceGroups: [
          { jid: '120363999999999@g.us', name: 'Grupo Sem Conexão' },
        ],
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.validated).toBe(false);

    // O grupo deve ter erros por não conseguir buscar mensagens
    const group = body.report.groups[0];
    expect(group.errors).toBeInstanceOf(Array);
    expect(group.errors.length).toBeGreaterThan(0);
    expect(group.passed).toBe(false);
  });

  test('sourceGroups mal formatado sem jid deve ser processado', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authPost(
      '/api/affiliate/validate-groups',
      token,
      {
        sourceGroups: [
          { name: 'Grupo sem JID' },
        ],
      },
    );
    expect(status).toBe(200);
    // O servidor deve processar sem crashar
    expect(body.success).toBe(true);
  });
});

// ─── POST /api/affiliate/groups-config ────────────────────────────────

test.describe('Affiliate - Configurar Espelhamento de Grupos', () => {
  test('deve rejeitar se sourceGroups estiver vazio', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authPost(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [],
        targetGroup: { jid: '120363000000000@g.us', name: 'Destino' },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Selecione pelo menos 1');
  });

  test('deve rejeitar se targetGroup estiver vazio', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authPost(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [{ jid: '120363123@g.us', name: 'Fonte' }],
        targetGroup: null,
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Selecione exatamente 1');
  });

  test('deve rejeitar se targetGroup não tiver jid', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authPost(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [{ jid: '120363123@g.us', name: 'Fonte' }],
        targetGroup: { name: 'Destino sem JID' },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Selecione exatamente 1');
  });

  test('deve rejeitar mais de 3 sourceGroups', async () => {
    const { token } = await createTestUser();

    const { status, body } = await authPost(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [
          { jid: '1@g.us', name: 'G1' },
          { jid: '2@g.us', name: 'G2' },
          { jid: '3@g.us', name: 'G3' },
          { jid: '4@g.us', name: 'G4' },
        ],
        targetGroup: { jid: '999@g.us', name: 'Destino' },
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Máximo de 3');
  });

  test('deve validar e tentar salvar configuração com formatos corretos', async () => {
    const { token } = await createTestUser();

    // Tenta salvar com grupos válidos (a validação das mensagens falha
    // porque não há WhatsApp conectado, mas o fluxo até a validação roda)
    const { status, body } = await authPost(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [
          { jid: '120363111111111@g.us', name: 'Ofertas Grupo 1' },
        ],
        targetGroup: { jid: '120363222222222@g.us', name: 'Repasse' },
      },
    );
    expect(status).toBe(200);

    // Esperado: a validação de ofertas falha porque não há instância
    // WhatsApp conectada para buscar mensagens reais
    if (!body.success) {
      expect(body.error).toContain('Validação de ofertas falhou');
    } else {
      // Caso a Evolution tenha devolvido dados (improvável em E2E),
      // deve retornar affiliateId
      expect(body.affiliateId).toBeDefined();
      expect(body.sourceGroups).toBeInstanceOf(Array);
      expect(body.targetGroup).toBeDefined();
    }
  });

  test('sourceGroups sem jid não deve crashar o servidor', async () => {
    const { token } = await createTestUser();

    const { status } = await authPost(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [{ name: 'Grupo inválido' }],
        targetGroup: { jid: '120363000@g.us', name: 'Destino' },
      },
    );
    expect(status).toBe(200);
  });
});

// ─── Webhook da Evolution API ──────────────────────────────────────────

test.describe('Webhook Evolution API', () => {
  const EVO_API_KEY = 'e2e-evolution-api-key';

  test('POST /webhook/message deve aceitar requisição com apikey inválido (webhook global não valida apikey)', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: 'invalid-key',
      },
      body: JSON.stringify({
        event: 'connection.update',
        instance: 'user-999',
        data: { state: 'open' },
      }),
    });
    // Webhook global não valida apikey porque a Evolution API
    // não envia o header em global webhooks (apenas em chamadas REST diretas)
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  test('POST /webhook/message deve aceitar evento connection.update', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVO_API_KEY,
      },
      body: JSON.stringify({
        event: 'connection.update',
        instance: 'user-1',
        data: { state: 'open', statusReason: 200 },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
  });

  test('POST /webhook/message deve aceitar evento messages.upsert', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVO_API_KEY,
      },
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'user-1',
        data: [
          {
            key: { remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
            message: { conversation: 'Olá! https://shopee.com.br/produto-X' },
            messageTimestamp: 1729000000,
            pushName: 'Teste',
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test('POST /webhook/message deve aceitar evento qrcode.updated', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVO_API_KEY,
      },
      body: JSON.stringify({
        event: 'qrcode.updated',
        instance: 'user-1',
        data: { count: 1, code: '2@...', base64: 'data:image/png;base64,fake' },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test('POST /webhook/message deve aceitar evento groups.upsert', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVO_API_KEY,
      },
      body: JSON.stringify({
        event: 'groups.upsert',
        instance: 'user-1',
        data: [{ id: '120363123456789@g.us', subject: 'Grupo Teste' }],
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test('POST /webhook/message deve aceitar evento group-participants.update', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVO_API_KEY,
      },
      body: JSON.stringify({
        event: 'group-participants.update',
        instance: 'user-1',
        data: {
          jid: '120363123456789@g.us',
          participants: ['5511999999999@s.whatsapp.net'],
          action: 'add',
        },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test('POST /webhook/message deve aceitar evento desconhecido sem erro', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVO_API_KEY,
      },
      body: JSON.stringify({
        event: 'some.unknown.event',
        instance: 'user-1',
        data: { foo: 'bar' },
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  test('POST /webhook/message deve aceitar requisição sem apikey (webhook global não exige)', async () => {
    // O webhook NÃO rejeita requisições sem apikey porque a
    // Evolution API global webhook não envia o header apikey
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'connection.update',
        instance: 'user-1',
        data: { state: 'open' },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(true);
  });
});
