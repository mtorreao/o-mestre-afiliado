/**
 * Testes E2E — Fluxo de Espelhamento de Mensagens (Mirror Pipeline)
 *
 * Este teste usa:
 *   - api-e2e-mirror (porta 15447) — API que aponta para o simulador
 *   - whatsapp-simulator-e2e (porta 15446) — simula a Evolution API
 *   - worker-e2e-mirror — processa as mensagens do Redis PubSub
 *
 * O simulador armazena mensagens "enviadas" e as expõe em GET /__admin/messages.
 * O teste verifica se, após enviar um webhook com uma oferta, a mensagem
 * aparece nos registros do simulador (enviada para o grupo de destino).
 */

import { test, expect } from '@playwright/test';
import {
  createTestUser,
} from './helpers.ts';

const API_MIRROR = process.env.API_MIRROR_URL || 'http://localhost:15447';
const SIMULATOR = process.env.SIMULATOR_URL || 'http://localhost:15446';

// ─── Helpers ─────────────────────────────────────────────────────────

async function authDelete(path: string, token: string) {
  const res = await fetch(`${API_MIRROR}${path}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function authGetMirror(path: string, token: string) {
  const res = await fetch(`${API_MIRROR}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function authPostMirror(path: string, token: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_MIRROR}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * Reseta o estado do simulador (limpa mensagens armazenadas).
 */
async function resetSimulator() {
  await fetch(`${SIMULATOR}/__admin/reset`, { method: 'POST' });
}

/**
 * Busca mensagens enviadas registradas no simulador.
 */
async function getSimulatorMessages(): Promise<
  Array<{ instanceName: string; number: string; text: string; timestamp: string }>
> {
  const res = await fetch(`${SIMULATOR}/__admin/messages`);
  const data = (await res.json()) as {
    success: boolean;
    messages: Array<{ instanceName: string; number: string; text: string; timestamp: string }>;
  };
  return data.messages ?? [];
}

/**
 * Poll o simulador até encontrar uma mensagem que contenha o texto esperado,
 * ou até o timeout.
 */
async function waitForMessageInSimulator(
  textContains: string,
  timeoutMs: number = 15000,
  intervalMs: number = 1000,
): Promise<{ found: boolean; messages: Array<{ instanceName: string; number: string; text: string }> }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const messages = await getSimulatorMessages();
    const match = messages.find((m) => m.text.includes(textContains));
    if (match) {
      return { found: true, messages };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // Timeout — retorna as mensagens encontradas até agora
  return { found: false, messages: await getSimulatorMessages() };
}

/**
 * Limpa instância WhatsApp do usuário no simulador.
 */
async function cleanupInstance(token: string) {
  try {
    await authDelete('/api/whatsapp/disconnect', token);
  } catch {
    // ignora
  }
}

/**
 * Cria um usuário e conecta WhatsApp (via simulador).
 */
async function createUserWithConnectedWhatsApp(): Promise<{
  token: string;
  user: { id: number; email: string; name: string };
}> {
  const { token, user } = await createTestUser(API_MIRROR);
  await cleanupInstance(token);

  // Conecta WhatsApp — o simulador aceita sempre
  const { status, body } = await authPostMirror('/api/whatsapp/connect', token, {});
  // Pode ser 200 se criou, ou outro se já existia
  if (status !== 200) {
    // Tenta novamente após cleanup
    await cleanupInstance(token);
    const retry = await authPostMirror('/api/whatsapp/connect', token, {});
    if (retry.status !== 200) {
      throw new Error(`Falha ao conectar WhatsApp: ${retry.status} ${JSON.stringify(retry.body)}`);
    }
  }

  return { token, user };
}

// ─── Tests ───────────────────────────────────────────────────────────

test.describe('Mirror Flow — Simulator', () => {
  test('GET /__admin/messages deve retornar lista vazia após reset', async () => {
    await resetSimulator();
    const messages = await getSimulatorMessages();
    expect(messages).toEqual([]);
  });

  test('POST /__admin/reset deve limpar estado', async () => {
    await resetSimulator();
    const res = await fetch(`${SIMULATOR}/__admin/reset`, { method: 'POST' });
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);

    const messages = await getSimulatorMessages();
    expect(messages).toEqual([]);
  });
});

test.describe('Mirror Flow — Instance (via Simulator)', () => {
  test('POST /api/whatsapp/connect deve retornar QR code', async () => {
    const { token } = await createTestUser(API_MIRROR);
    await cleanupInstance(token);

    const { status, body } = await authPostMirror('/api/whatsapp/connect', token, {});
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.instanceId).toBeDefined();
    // O simulador retorna QR code
    expect(body.qrcode).toBeTruthy();
  });

  test('GET /api/whatsapp/status deve retornar connected após conectar', async () => {
    const { token } = await createTestUser(API_MIRROR);
    await cleanupInstance(token);
    await authPostMirror('/api/whatsapp/connect', token, {});

    const { status, body } = await authGetMirror('/api/whatsapp/status', token);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    // Simulador conecta sempre
    expect(body.connected).toBe(true);
    expect(body.status).toBe('connected');
  });
});

test.describe('Mirror Flow — Groups Config', () => {
  test('GET /api/whatsapp/groups deve retornar grupos do simulador', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    const { status, body } = await authGetMirror('/api/whatsapp/groups', token);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const groups = body.groups as Array<{ jid: string; name: string }>;
    expect(groups.length).toBeGreaterThanOrEqual(3);
    expect(groups[0]?.jid).toContain('@g.us');
    expect(groups[0]?.name).toBeTruthy();
  });

  test('POST /api/affiliate/groups-config — valida sourceGroups vazio', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    const { status, body } = await authPostMirror(
      '/api/affiliate/groups-config',
      token,
      { sourceGroups: [], targetGroups: [{ jid: '120363000000000003@g.us', name: 'Destino' }] },
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('pelo menos 1');
  });

  test('POST /api/affiliate/groups-config — valida sourceGroups > 3', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    const manyGroups = Array.from({ length: 5 }, (_, i) => ({
      jid: `12036300000000000${i}@g.us`,
      name: `Grupo ${i}`,
    }));

    const { status, body } = await authPostMirror(
      '/api/affiliate/groups-config',
      token,
      { sourceGroups: manyGroups, targetGroups: [{ jid: '120363000000000003@g.us', name: 'Destino' }] },
    );
    expect(body.success).toBe(false);
    expect(body.error).toContain('Máximo de 3');
  });

  test('POST /api/affiliate/groups-config — valida targetGroups vazio', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    const { status, body } = await authPostMirror(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Grupo 1' }],
        targetGroups: null,
      },
    );
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/pelo menos 1|Selecione pelo menos/);
  });

  test('POST /api/affiliate/groups-config — valida ofertas com sucesso (simulador retorna 50%+ links)', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    // O simulador retorna 6/7 mensagens com links de marketplace no grupo 1 (~86%)
    // Configurando este grupo como source, a validação deve passar
    const { status, body } = await authPostMirror(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
        targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.affiliateId).toBeDefined();
    expect(body.sourceGroups).toBeDefined();
    expect(body.targetGroups).toBeDefined();
  });
});

test.describe('Mirror Flow — Webhook → Worker → Simulator', () => {
  test.beforeEach(async () => {
    await resetSimulator();
  });

  test('Mensagem de grupo com link de marketplace é processada e enviada ao destino', async () => {
    // ── 1. Setup: cria usuário, conecta WhatsApp, configura grupos ──
    const { token } = await createUserWithConnectedWhatsApp();

    // Configura grupos: sourceGroup = grupo 1 (tem 86% links de marketplace),
    // targetGroup = grupo 3
    const configRes = await authPostMirror(
      '/api/affiliate/groups-config',
      token,
      {
        sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
        targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
      },
    );
    expect(configRes.body.success).toBe(true);

    // ── 2. Simula webhook: Evolution API envia messages.upsert ──────
    const webhookPayload = {
      event: 'messages.upsert',
      instance: 'user-1',
      data: [
        {
          key: {
            id: 'e2e_test_msg_001',
            remoteJid: '120363000000000001@g.us',
            fromMe: false,
          },
          message: {
            conversation: 'Oferta imperdível! https://shopee.com.br/produto-E2E-Test-123',
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
          pushName: 'Test E2E',
        },
      ],
    };

    const webhookRes = await fetch(`${API_MIRROR}/webhook/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });
    expect(webhookRes.status).toBe(200);

    // ── 3. Aguarda o worker processar e enviar para o simulador ────
    // O worker vai: detectar link → converter → montar template →
    // enviar para grupo 3 via Evolution API (simulador)
    const { found, messages } = await waitForMessageInSimulator(
      'https://shopee.com.br/produto-E2E-Test-123',
      20000,
    );

    expect(found).toBe(true);
    // A mensagem deve ter sido enviada para o grupo de destino (grupo 3)
    const sentMsg = messages.find((m) =>
      m.text.includes('https://shopee.com.br/produto-E2E-Test-123'),
    );
    expect(sentMsg).toBeDefined();
    expect(sentMsg!.number).toBe('120363000000000003@g.us');
    expect(sentMsg!.text).toContain('shopee.com.br');
    expect(sentMsg!.text).not.toContain('undefined');  // template bem formado
  });

  test('Mensagem de grupo sem link de marketplace é ignorada', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    // Configura grupos
    await authPostMirror('/api/affiliate/groups-config', token, {
      sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
      targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
    });

    // Mensagem SEM link de marketplace
    await fetch(`${API_MIRROR}/webhook/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'user-1',
        data: [
          {
            key: {
              id: 'e2e_test_msg_no_link',
              remoteJid: '120363000000000001@g.us',
              fromMe: false,
            },
            message: { conversation: 'Bom dia pessoal! Tudo bem?' },
            messageTimestamp: Math.floor(Date.now() / 1000),
            pushName: 'Test',
          },
        ],
      }),
    });

    // Aguarda um momento e verifica que NADA foi enviado
    await new Promise((r) => setTimeout(r, 3000));
    const messages = await getSimulatorMessages();
    // Nenhuma mensagem do worker deve ter sido enviada
    const mirrorMessages = messages.filter(
      (m) => m.instanceName === 'user-1' && m.number === '120363000000000003@g.us',
    );
    expect(mirrorMessages.length).toBe(0);
  });

  test('Mensagem de grupo desconhecido (sem cache) é ignorada', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    // Configura grupos
    await authPostMirror('/api/affiliate/groups-config', token, {
      sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
      targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
    });

    // Mensagem de um grupo NÃO configurado como source
    await fetch(`${API_MIRROR}/webhook/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'user-1',
        data: [
          {
            key: {
              id: 'e2e_test_msg_unknown_group',
              remoteJid: '120363999999999999@g.us',
              fromMe: false,
            },
            message: { conversation: 'Oferta! https://shopee.com.br/produto-Unknown-Group' },
            messageTimestamp: Math.floor(Date.now() / 1000),
            pushName: 'Test',
          },
        ],
      }),
    });

    // Aguarda e verifica que NADA foi enviado para grupo destino
    await new Promise((r) => setTimeout(r, 3000));
    const messages = await getSimulatorMessages();
    const mirrorMessages = messages.filter(
      (m) => m.text.includes('shopee.com.br/produto-Unknown-Group'),
    );
    expect(mirrorMessages.length).toBe(0);
  });

  test('Mensagem fromMe (enviada pelo próprio bot) é ignorada', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    await authPostMirror('/api/affiliate/groups-config', token, {
      sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
      targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
    });

    // Mensagem com fromMe=true
    await fetch(`${API_MIRROR}/webhook/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'messages.upsert',
        instance: 'user-1',
        data: [
          {
            key: {
              id: 'e2e_test_msg_from_me',
              remoteJid: '120363000000000001@g.us',
              fromMe: true,
            },
            message: { conversation: 'Oferta! https://shopee.com.br/produto-FromMe' },
            messageTimestamp: Math.floor(Date.now() / 1000),
            pushName: 'Bot',
          },
        ],
      }),
    });

    await new Promise((r) => setTimeout(r, 3000));
    const messages = await getSimulatorMessages();
    const mirrorMessages = messages.filter(
      (m) => m.text.includes('shopee.com.br/produto-FromMe'),
    );
    expect(mirrorMessages.length).toBe(0);
  });
});
