/**
 * WhatsApp Simulator — substituto da Evolution API para testes E2E.
 *
 * Simula os endpoints da Evolution API v2 necessários para o fluxo de
 * espelhamento de mensagens. Armazena mensagens enviadas em memória para
 * que os testes possam verificar o que foi "enviado para o WhatsApp".
 *
 * Endpoints administrativos (para os testes):
 *   GET  /__admin/messages  — lista mensagens enviadas
 *   POST /__admin/reset     — limpa todo o estado
 */

import { Elysia } from 'elysia';

// ─── State ──────────────────────────────────────────────────────────────

/** Instâncias criadas: instanceName → { status } */
const instances = new Map<string, { status: string }>();

/** Mensagens enviadas via sendText */
const sentMessages: Array<{
  instanceName: string;
  number: string;
  text: string;
  timestamp: string;
  linkPreview?: boolean;
}> = [];

/** Request ID counter */
let requestIdCounter = 1;

// ─── Mock data ──────────────────────────────────────────────────────────

const MOCK_QR_BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const MOCK_GROUPS = [
  { jid: '120363000000000001@g.us', subject: 'Ofertas Promoções', name: 'Ofertas Promoções' },
  { jid: '120363000000000002@g.us', subject: 'Grupo Teste 2', name: 'Grupo Teste 2' },
  { jid: '120363000000000003@g.us', subject: 'Grupo Teste 3', name: 'Grupo Teste 3' },
];

/** Mensagens mockadas com links de marketplace para validação de grupos */
const MOCK_MESSAGES = [
  {
    key: { id: 'mock_msg_1', remoteJid: '120363000000000001@g.us', fromMe: false },
    message: { conversation: 'Olha essa oferta! https://shopee.com.br/produto-XYz123' },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'João',
  },
  {
    key: { id: 'mock_msg_2', remoteJid: '120363000000000001@g.us', fromMe: false },
    message: { conversation: 'https://mercadolivre.com.br/produto-ABC' },
    messageTimestamp: Math.floor(Date.now() / 1000) - 60,
    pushName: 'Maria',
  },
  {
    key: { id: 'mock_msg_3', remoteJid: '120363000000000001@g.us', fromMe: false },
    message: { conversation: 'Hoje está barato! https://shopee.com.br/produto-456' },
    messageTimestamp: Math.floor(Date.now() / 1000) - 120,
    pushName: 'Carlos',
  },
  {
    key: { id: 'mock_msg_4', remoteJid: '120363000000000001@g.us', fromMe: false },
    message: { conversation: 'Bom dia grupo! 😊' },
    messageTimestamp: Math.floor(Date.now() / 1000) - 180,
    pushName: 'Ana',
  },
  {
    key: { id: 'mock_msg_5', remoteJid: '120363000000000001@g.us', fromMe: false },
    message: { conversation: 'Alguém tem o link da Shopee? https://shopee.com.br/produto-789' },
    messageTimestamp: Math.floor(Date.now() / 1000) - 240,
    pushName: 'Pedro',
  },
  {
    key: { id: 'mock_msg_6', remoteJid: '120363000000000001@g.us', fromMe: false },
    message: { conversation: 'Olha que legal: https://amazon.com.br/produto-XYZ' },
    messageTimestamp: Math.floor(Date.now() / 1000) - 300,
    pushName: 'João',
  },
  {
    key: { id: 'mock_msg_7', remoteJid: '120363000000000002@g.us', fromMe: false },
    message: { conversation: 'Sem link esse grupo' },
    messageTimestamp: Math.floor(Date.now() / 1000) - 360,
    pushName: 'João',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────

function genId(): string {
  return `sim_${requestIdCounter++}_${Date.now()}`;
}

// ─── App ────────────────────────────────────────────────────────────────

const app = new Elysia()
  .onError(({ code, error, set }) => {
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: true, message: `Endpoint não encontrado: ${error}` };
    }
    set.status = 500;
    return { error: true, message: error?.message ?? 'Erro interno' };
  })

  // ═══════════════════════════════════════════════════════════════════════
  // ADMIN — para os testes inspecionarem o estado
  // ═══════════════════════════════════════════════════════════════════════

  .get('/__admin/messages', () => ({
    success: true,
    messages: sentMessages,
    count: sentMessages.length,
  }))

  .post('/__admin/reset', () => {
    instances.clear();
    sentMessages.length = 0;
    requestIdCounter = 1;
    return { success: true, message: 'Estado do simulador resetado' };
  })

  // ═══════════════════════════════════════════════════════════════════════
  // INSTANCE
  // ═══════════════════════════════════════════════════════════════════════

  .post('/instance/create', ({ body, set }) => {
    const { instanceName } = (body || {}) as { instanceName?: string };
    if (!instanceName) {
      set.status = 400;
      return { error: 'instanceName é obrigatório' };
    }

    // Verifica se já existe
    if (instances.has(instanceName)) {
      set.status = 403;
      return { error: `This name '${instanceName}' is already in use.` };
    }

    // Cria a instância já como "open" (conectada) para simplificar testes
    instances.set(instanceName, { status: 'open' });

    return {
      instance: {
        instanceName,
        status: 'open',
        qrcode: {
          count: 1,
          code: `mock-${genId()}`,
          base64: MOCK_QR_BASE64,
        },
      },
      // qrcode também no top level (a Evolution API retorna em ambos os lugares)
      qrcode: {
        count: 1,
        code: `mock-${genId()}`,
        base64: MOCK_QR_BASE64,
      },
      hash: { apikey: 'mock-hash' },
    };
  })

  .get('/instance/connect/:instanceName', ({ params: { instanceName }, set }) => {
    if (!instances.has(instanceName)) {
      instances.set(instanceName, { status: 'connecting' });
    }
    const inst = instances.get(instanceName)!;
    inst.status = 'connecting';

    return {
      base64: MOCK_QR_BASE64,
      code: `mock-${genId()}`,
      count: 1,
    };
  })

  .get('/instance/connectionState/:instanceName', ({ params: { instanceName } }) => {
    if (!instances.has(instanceName)) {
      return { state: { connectionState: 'close' } };
    }
    return {
      instance: { state: instances.get(instanceName)!.status === 'created' ? 'connecting' : 'open' },
      state: { connectionState: instances.get(instanceName)!.status },
    };
  })

  .get('/instance/qrcode/:instanceName', ({ params: { instanceName }, set }) => {
    if (!instances.has(instanceName)) {
      set.status = 404;
      return { error: 'Instância não encontrada' };
    }
    return {
      base64: MOCK_QR_BASE64,
      code: `mock-${genId()}`,
      count: 1,
    };
  })

  .delete('/instance/delete/:instanceName', ({ params: { instanceName } }) => {
    instances.delete(instanceName);
    return { success: true };
  })

  .delete('/instance/logout/:instanceName', () => {
    return { success: true };
  })

  .get('/instance/fetchInstances', () => {
    const list = Array.from(instances.entries()).map(([name, data]) => ({
      instanceName: name,
      status: data.status === 'connecting' || data.status === 'created' ? 'open' : data.status,
      integration: 'WHATSAPP-BAILEYS',
      ownerJid: '5511999999999@s.whatsapp.net',
      profileName: 'Simulador E2E',
    }));
    return list;
  })

  // ═══════════════════════════════════════════════════════════════════════
  // GROUP
  // ═══════════════════════════════════════════════════════════════════════

  .get('/group/fetchAllGroups/:instanceName', ({ params: { instanceName } }) => {
    // Retorna no formato que a Evolution API v2 usa: { [instanceName]: [...] }
    return {
      [instanceName]: MOCK_GROUPS,
    };
  })

  // ═══════════════════════════════════════════════════════════════════════
  // CHAT
  // ═══════════════════════════════════════════════════════════════════════

  .post('/chat/findMessages/:instanceName', ({ body }) => {
    const { jid, count } = (body || {}) as { jid?: string; count?: number };

    // Filtra mensagens do grupo, contendo links de marketplace
    let messages = MOCK_MESSAGES;
    if (jid) {
      messages = messages.filter((m) => m.key.remoteJid === jid);
    }
    if (count && count > 0) {
      messages = messages.slice(0, count);
    }

    // Retorna no formato paginado da Evolution API v2
    return {
      messages: {
        records: messages,
        total: messages.length,
        pages: 1,
        currentPage: 1,
      },
    };
  })

  // ═══════════════════════════════════════════════════════════════════════
  // MESSAGE
  // ═══════════════════════════════════════════════════════════════════════

  .post('/message/sendText/:instanceName', ({ params: { instanceName }, body }) => {
    const { number, text, delay, linkPreview } = (body || {}) as {
      number?: string;
      text?: string;
      delay?: number;
      linkPreview?: boolean;
    };

    // Armazena a mensagem enviada para verificação nos testes
    sentMessages.push({
      instanceName,
      number: number ?? '',
      text: text ?? '',
      timestamp: new Date().toISOString(),
      linkPreview,
    });

    return {
      key: {
        id: genId(),
        remoteJid: number ?? '',
        fromMe: true,
      },
      status: 'PENDING',
    };
  })

  // ═══════════════════════════════════════════════════════════════════════
  // Health check
  // ═══════════════════════════════════════════════════════════════════════

  .get('/health', () => ({ status: 'ok', service: 'whatsapp-simulator' }))

  // ═══════════════════════════════════════════════════════════════════════
  // Catch-all: qualquer outro endpoint retorna 404 com corpo JSON
  // ═══════════════════════════════════════════════════════════════════════

  .all('/*', ({ set }) => {
    set.status = 404;
    return { error: true, message: 'Endpoint não encontrado no simulador' };
  });

// ─── Start ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.SIMULATOR_PORT || '8080', 10);

app.listen(PORT, () => {
  console.log(`[whatsapp-simulator] Rodando em :${PORT}`);
  console.log(`[whatsapp-simulator] Admin: GET /__admin/messages, POST /__admin/reset`);
});

export type { app };
