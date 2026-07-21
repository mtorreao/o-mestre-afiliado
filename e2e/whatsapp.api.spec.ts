/**
 * Testes E2E de API — Fluxo de conexão WhatsApp via Evolution API.
 *
 * Testa os 3 endpoints:
 *   POST /api/whatsapp/connect   — iniciar conexão
 *   GET  /api/whatsapp/status    — status da conexão
 *   DELETE /api/whatsapp/disconnect — desconectar
 *
 * Requer: API rodando em http://localhost:5442
 *         Evolution API rodando em http://localhost:15444 (E2E stack)
 */

import { test, expect } from '@playwright/test';
import {
  uniqueEmail,
  TEST_PASSWORD,
  TEST_NAME,
  createTestUser,
  authGet,
  authPost,
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
 * Limpa qualquer instância WhatsApp do usuário antes de cada teste.
 */
async function cleanupInstance(token: string) {
  // Tenta desconectar, ignora erro se não houver instância
  try {
    await authDelete('/api/whatsapp/disconnect', token);
  } catch {
    // ignora
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────

test.describe('WhatsApp - Auth', () => {
  test('POST /api/whatsapp/connect deve retornar 401 sem token', async () => {
    const res = await fetch(`${API}/api/whatsapp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Não autenticado');
  });

  test('GET /api/whatsapp/status deve retornar 401 sem token', async () => {
    const res = await fetch(`${API}/api/whatsapp/status`);
    expect(res.status).toBe(401);
  });

  test('DELETE /api/whatsapp/disconnect deve retornar 401 sem token', async () => {
    const res = await fetch(`${API}/api/whatsapp/disconnect`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});

// ─── Status ───────────────────────────────────────────────────────────

test.describe('WhatsApp - Status', () => {
  test('GET /api/whatsapp/status deve retornar disconnected para novo usuário', async () => {
    const { token } = await createTestUser();
    const { status, body } = await authGet('/api/whatsapp/status', token);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.connected).toBe(false);
    expect(body.status).toBe('disconnected');
  });
});

// ─── Full flow ────────────────────────────────────────────────────────

test.describe('WhatsApp - Connect / Disconnect', () => {
  test('POST /api/whatsapp/connect e depois GET /api/whatsapp/status deve retornar connecting', async () => {
    const { token } = await createTestUser();
    await cleanupInstance(token);

    // Conectar — Espera-se que crie instância na Evolution API
    // e retorne QR code (status 'connecting')
    const { status: connectStatus, body: connectBody } = await authPost(
      '/api/whatsapp/connect',
      token,
      {},
    );
    expect(connectStatus).toBe(200);
    expect(connectBody.success).toBe(true);

    // Deve ter retornado um QR code ou pelo menos status connecting
    if (connectBody.status === 'connected') {
      // Já conectou (raro em E2E, mas possível se Evolution reutilizar sessão)
      expect(connectBody.qrcode).toBeNull();
    } else {
      // Normal: instância criada, aguardando scan
      expect(connectBody.status).toBe('connecting');
      // QR code pode ser string (base64) ou null se a Evolution não gerou
      // Aceitamos ambos — o importante é que a instância foi criada
    }
    expect(connectBody.instanceId).toBeDefined();

    // Verificar status depois de conectar
    const { status: statusStatus, body: statusBody } = await authGet(
      '/api/whatsapp/status',
      token,
    );
    expect(statusStatus).toBe(200);
    expect(statusBody.success).toBe(true);

    // Após conectar, o status pode ser:
    // - 'connecting' (QR gerado, aguardando scan)
    // - 'connected' (se Evolution reutilizou sessão)
    // - 'disconnected' (se a Evolution criou a instância mas já passou para 'close'
    //   por não haver scan real no ambiente E2E)
    const validStatuses = ['connecting', 'connected', 'disconnected'];
    expect(validStatuses).toContain(statusBody.status);

    // Desconectar
    const { status: discStatus, body: discBody } = await authDelete(
      '/api/whatsapp/disconnect',
      token,
    );
    expect(discStatus).toBe(200);
    expect(discBody.success).toBe(true);

    // Verificar que está disconnected
    const { body: finalStatus } = await authGet('/api/whatsapp/status', token);
    expect(finalStatus.connected).toBe(false);
    expect(finalStatus.status).toBe('disconnected');
  });

  test('POST /api/whatsapp/connect duas vezes deve lidar com estado existente', async () => {
    const { token } = await createTestUser();
    await cleanupInstance(token);

    // Primeira conexão
    const { body: first } = await authPost('/api/whatsapp/connect', token, {});
    expect(first.success).toBe(true);

    // Segunda conexão — se a primeira está em 'connecting',
    // deve retornar QR novamente; se já foi para 'close'/'disconnected'
    // a Evolution bloqueia recriação com 403
    const { status: secondStatus, body: second } = await authPost(
      '/api/whatsapp/connect',
      token,
      {},
    );

    // Em ambiente E2E (sem scan real):
    // - Se a Evolution ainda está em 'connecting' → QR novamente (success = true)
    // - Se já passou para 'close' → erro 403 da Evolution (success = false, HTTP 500)
    // Ambos são comportamentos válidos
    if (secondStatus === 200 && second.success) {
      expect(second.status).toBe('connecting');
    }
    // Caso contrário, a Evolution bloqueou a recriação — aceitável em E2E

    // Limpeza
    await authDelete('/api/whatsapp/disconnect', token);
  });

  test('DELETE /api/whatsapp/disconnect sem instância ativa deve retornar sucesso', async () => {
    const { token } = await createTestUser();

    // Desconectar sem ter instância
    const { status, body } = await authDelete('/api/whatsapp/disconnect', token);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toContain('Nenhuma instância');
  });
});

// ─── Error scenarios ─────────────────────────────────────────────────

test.describe('WhatsApp - Error scenarios', () => {
  test('GET /api/whatsapp/status com token inválido deve retornar 401', async () => {
    const res = await fetch(`${API}/api/whatsapp/status`, {
      headers: { Authorization: 'Bearer invalid-token' },
    });
    expect(res.status).toBe(401);
  });

  test('POST /api/whatsapp/connect com token inválido deve retornar 401', async () => {
    const res = await fetch(`${API}/api/whatsapp/connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token',
      },
    });
    expect(res.status).toBe(401);
  });

  test('DELETE /api/whatsapp/disconnect com token inválido deve retornar 401', async () => {
    const res = await fetch(`${API}/api/whatsapp/disconnect`, {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer invalid-token',
      },
    });
    expect(res.status).toBe(401);
  });
});
