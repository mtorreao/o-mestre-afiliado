/**
 * Testes E2E de API — Webhook da Evolution API e listagem de grupos WhatsApp.
 *
 * ANTIGAMENTE: e2e/whatsapp-extended.api.spec.ts (504 linhas, 18 testes).
 *
 * Cobertura:
 *   - GET /api/whatsapp/groups             — listar grupos (requer conexão)
 *   - POST /webhook/message                — handler global da Evolution API
 *
 * Requer: API rodando em http://localhost:15442 (E2E stack)
 *         Evolution API rodando em http://localhost:15444
 *
 * ─────────────────────────────────────────────────────────────────
 * REMOVIDOS neste trim (endpoints refatorados/removidos no Worker v2):
 *   - POST /api/affiliate/validate-groups → sem replacement (validação é implícita no webhook handler)
 *   - POST /api/affiliate/groups-config   → substituído por POST /api/mirrors
 *     (cobertura equivalente em e2e/mirrors.api.spec.ts)
 * ─────────────────────────────────────────────────────────────────
 */

import { test, expect } from '@playwright/test';
import {
  createTestUser,
  authGet,
} from './helpers.ts';

const API = process.env.API_URL || `http://localhost:${process.env.API_PORT || '15442'}`;

// ─── GET /api/whatsapp/groups — Auth ─────────────────────────────────

test.describe('WhatsApp Groups - Auth', () => {
  test('GET /api/whatsapp/groups deve retornar 401 sem token', async () => {
    const res = await fetch(`${API}/api/whatsapp/groups`);
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
  });
});

// ─── GET /api/whatsapp/groups — Listagem ─────────────────────────────

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

// ─── POST /webhook/message — Handler global Evolution API ────────────

test.describe('Webhook Evolution API', () => {
  const EVO_API_KEY = 'e2e-evolution-api-key';

  test('POST /webhook/message deve aceitar requisição com apikey inválido (webhook global não valida apikey)', async () => {
    const res = await fetch(`${API}/webhook/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EVO_API_KEY + '-invalida',
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
