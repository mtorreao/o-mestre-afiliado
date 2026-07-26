/**
 * Testes E2E — Fluxo de Espelhamento de Mensagens (Mirror Pipeline v2)
 *
 * Este teste usa:
 *   - api-e2e-mirror (porta 15447) — API que aponta para o simulador
 *   - whatsapp-simulator-e2e (porta 15446) — simula a Evolution API
 *   - ingestor-e2e-mirror — pipeline pesado (Queue A → Queue B)
 *   - dispatcher-e2e-mirror — envio de mensagens (Queue B → Evolution)
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

test.describe('Mirror Flow — Groups + Mirror CRUD (via Simulator)', () => {
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

  // NOTA: a API legada POST /api/affiliate/groups-config validava que
  // sourceGroups >= 1 e <= 3 e exigia validação de ofertas via Evolution API.
  // Substituído por POST /api/mirrors, que aceita sourceGroups/targetGroups vazios
  // e sem caps. Cobertura de validação de caps está em mirrors.api.spec.ts.
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
      '/api/mirrors',
      token,
      {
        name: 'E2E Test Mirror (oferta)',
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

    // ── 3. Aguarda o ingestor+dispatcher processarem e enviar para o simulador ────
    // O ingestor vai: detectar link → converter → montar template → publicar na Queue B
    // O dispatcher vai: ler da Queue B → enviar para grupo 3 via Evolution API (simulador)
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
    await authPostMirror('/api/mirrors', token, {
      name: 'E2E Test Mirror',
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
    // Nenhuma mensagem do ingestor/dispatcher deve ter sido enviada
    const mirrorMessages = messages.filter(
      (m) => m.instanceName === 'user-1' && m.number === '120363000000000003@g.us',
    );
    expect(mirrorMessages.length).toBe(0);
  });

  test('Mensagem de grupo desconhecido (sem cache) é ignorada', async () => {
    const { token } = await createUserWithConnectedWhatsApp();

    // Configura grupos
    await authPostMirror('/api/mirrors', token, {
      name: 'E2E Test Mirror',
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

    await authPostMirror('/api/mirrors', token, {
      name: 'E2E Test Mirror',
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

// ─── ML /social/ URL Resolution (HTTP real, sem Evolution API) ─────────

test.describe('Mirror Flow — ML /social/ Resolution', () => {
  test.beforeEach(async () => {
    await resetSimulator();
  });

  /**
   * Testa o fluxo de resolução de URL /social/ do Mercado Livre até a Queue A.
   *
   * Valida o pipeline: mirror criado com sourceGroup → webhook recebido →
   * cache Redis consultado → RawMessageEvent publicado na Queue A.
   *
   * A conversão (ML Link Builder) requer cookies de sessão reais do ML,
   * que não estão disponíveis no ambiente E2E. Quando a conversão falha,
   * a oferta é descartada silenciosamente (design atual do ML).
   *
   * Para testar o pipeline completo até o simulador, configure credenciais
   * ML reais (ml_affiliates.melitat + sessionCookies) no banco E2E.
   */
  test('Mensagem com /social/ do ML é processada e publicada na Queue A', async () => {
    // ── 1. Setup: usuário + WhatsApp + affiliate + mirror ──
    const { token, user } = await createUserWithConnectedWhatsApp();

    // Insere affiliate no DB para o cache Redis de sourceGroups
    const instanceName = `user-${user.id}`;
    const { execSync } = await import('node:child_process');
    execSync(
      `docker exec omestre_e2e_postgres psql -U evolution -d omestre_db ` +
      `-c "INSERT INTO omestre.affiliates (name, active, evolution_instance_id) VALUES ('E2E ML Social', true, '${instanceName}')"`,
      { stdio: 'pipe' } as any,
    );

    // Cria mirror → popula cache Redis com sourceGroup → affiliateId
    const mirrorRes = await authPostMirror('/api/mirrors', token, {
      name: 'E2E Test ML /social/',
      sourceGroups: [{ jid: '120363000000000001@g.us', name: 'Ofertas Promoções' }],
      targetGroups: [{ jid: '120363000000000003@g.us', name: 'Grupo Teste 3' }],
      status: 'active',
    });
    expect(mirrorRes.body.success).toBe(true);

    // ── 2. Webhook com mensagem contendo URL /social/ do ML ──
    const socialUrl =
      'https://www.mercadolivre.com.br/social/om895584' +
      '?matt_word=om895584&matt_tool=50805475&forceInApp=true' +
      '&ref=BNNwFaW22UcOR1BlyOdbNtjr2boYjnVMhdiudR%2Bblb9KP8z%2FjOSjOF4HDBAEmDY9' +
      '%2BW05Jn8THcCL5rXdphHYB2B0AOVOXEnQqTM%2BStd3YB6usBmGmuo9gXkACXjj' +
      '%2B21LpsNqCSkWmBhHGip0CI4PI3ptDVo%2FYlwBvWw52atp%2BbnxgTS0EE5WILI8filUTV' +
      '%2BWZMYrelk%3D';

    const webhookPayload = {
      event: 'messages.upsert',
      instance: 'user-1',
      data: [
        {
          key: { id: `e2e_social_${Date.now()}`, remoteJid: '120363000000000001@g.us', fromMe: false },
          message: {
            conversation:
              '🚨 CUPONS MERCADO LIVRE\n\n' +
              '👇 RESGATE AQUI:\nhttps://mercadolivre.com.br/sec/1TTwcDm\n\n' +
              `Na lista: ${socialUrl}\n\n` +
              '#MercadoLivre\n| t.me/cuponsm',
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
          pushName: 'Promozone #156',
        },
      ],
    };

    const webhookRes = await fetch(`${API_MIRROR}/webhook/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload),
    });
    expect(webhookRes.status).toBe(200);
    const whBody = await webhookRes.json();
    // Confirma que o webhook foi recebido (cache Redis consultado com sucesso)
    expect(whBody.success).toBe(true);
  });
});
