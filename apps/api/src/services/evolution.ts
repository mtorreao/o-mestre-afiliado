/**
 * Cliente para Evolution API v2.
 *
 * Gerencia o ciclo de vida de instâncias WhatsApp:
 *   create → connect (QR code) → status → disconnect
 *
 * A Evolution API roda no container evolution_api e é exposta
 * na porta EVOLUTION_API_PORT (default 5444) no host.
 */

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'http://localhost:5444';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
const WEBHOOK_URL =
  process.env.WEBHOOK_URL || 'http://localhost:5442/webhook/message';

export interface QrCodeResult {
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
}

export interface InstanceConnectionState {
  instanceName: string;
  state: 'open' | 'close' | 'connecting';
}

// ─── Utilitários ─────────────────────────────────────────────────────

/** Pausa assíncrona de ms milissegundos. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY,
  };
}

/**
 * Normaliza o nome da instância a partir do userId.
 */
export function instanceNameFromUserId(userId: number): string {
  return `user-${userId}`;
}

/**
 * Extrai o userId do nome da instância.
 */
export function userIdFromInstanceName(instanceName: string): number | null {
  const match = instanceName.match(/^user-(\d+)$/);
  return match ? parseInt(match[1]!, 10) : null;
}

// ─── API calls ───────────────────────────────────────────────────────

/**
 * Cria uma nova instância na Evolution API.
 *
 * Se a instância já existir (não deletada), a Evolution retorna
 * os dados existentes, incluindo o QR code se ainda estiver
 * no estado "connecting".
 */
export async function createInstance(instanceName: string): Promise<{
  success: boolean;
  instance?: { instanceName: string; status: string };
  qrcode?: QrCodeResult;
  error?: string;
}> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        instanceName,
        token: EVOLUTION_API_KEY,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        webhook: {
          enabled: true,
          url: WEBHOOK_URL,
          events: [
            'messages.upsert',
            'connection.update',
            'qrcode.updated',
            'groups.upsert',
            'group-participants.update',
          ],
          byEvents: true,
          base64: false,
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as Record<string, unknown>;
    const instance = data.instance as Record<string, unknown> | undefined;
    const qrcode = data.qrcode as Record<string, unknown> | undefined;

    return {
      success: true,
      instance: instance
        ? {
            instanceName: String(instance.instanceName ?? ''),
            status: String(instance.status ?? 'close'),
          }
        : undefined,
      qrcode: qrcode
        ? {
            base64: (qrcode.base64 as string) ?? null,
            code: (qrcode.code as string) ?? null,
            pairingCode: (qrcode.pairingCode as string) ?? null,
          }
        : undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao conectar na Evolution API',
    };
  }
}

/**
 * Obtém o QR code de uma instância existente.
 */
export async function getQrCode(instanceName: string): Promise<{
  success: boolean;
  qrcode?: QrCodeResult;
  error?: string;
}> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/qrcode/${instanceName}`, {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as Record<string, unknown>;

    return {
      success: true,
      qrcode: {
        base64: (data.base64 as string) ?? null,
        code: (data.code as string) ?? null,
        pairingCode: (data.pairingCode as string) ?? null,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao obter QR code',
    };
  }
}

/**
 * Consulta o status de conexão de uma instância.
 */
export async function getConnectionState(instanceName: string): Promise<{
  success: boolean;
  state?: InstanceConnectionState;
  error?: string;
}> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`,
      {
        method: 'GET',
        headers: headers(),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as {
      state?: { connectionState?: string };
      instance?: { state?: string };
    };

    // Evolution API v2.3.7 retorna { instance: { state: "connecting" } }
    // (versões anteriores usavam { state: { connectionState: "..." } })
    const rawState =
      data.instance?.state ?? data.state?.connectionState;
    let state: 'open' | 'close' | 'connecting' = 'close';
    if (rawState === 'open') state = 'open';
    else if (rawState === 'connecting') state = 'connecting';

    return {
      success: true,
      state: { instanceName, state },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao consultar status',
    };
  }
}

/**
 * Deleta uma instância da Evolution API.
 */
export async function deleteInstance(instanceName: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/delete/${instanceName}`, {
      method: 'DELETE',
      headers: headers(),
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao desconectar instância',
    };
  }
}

/**
 * Busca todos os grupos do WhatsApp que a instância participa.
 *
 * Evolution API v2: GET /group/fetchAllGroups/{instanceName}?getParticipants=true
 * Retorna array direto de grupos com id, subject, etc.
 * (v1 usava POST /chat/fetchAllGroups/{instanceName})
 */
export async function fetchGroups(instanceName: string): Promise<{
  success: boolean;
  groups?: { jid: string; name: string }[];
  error?: string;
}> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/group/fetchAllGroups/${instanceName}?getParticipants=true`,
      {
        method: 'GET',
        headers: headers(),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    const raw = (await res.json()) as Record<string, unknown>;

    // Evolution API v2 retorna o objeto no formato:
    // { [instanceName]: [ { jid, name, ... }, ... ] }
    // ou direto um array
    let groupList: unknown[] = [];

    if (Array.isArray(raw)) {
      groupList = raw;
    } else {
      // Tenta extrair do campo com nome da instância
      for (const key of Object.keys(raw)) {
        if (Array.isArray(raw[key])) {
          groupList = raw[key] as unknown[];
          break;
        }
      }
    }

    const groups = groupList
      .map((g) => {
        const item = g as Record<string, unknown>;
        const jid = String(item.jid ?? item.id ?? '');
        const name = String(item.name ?? item.subject ?? '');
        return { jid, name };
      })
      .filter((g) => g.jid && g.name);

    return { success: true, groups };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao buscar grupos',
    };
  }
}

/**
 * Busca informações de um grupo específico via Evolution API.
 *
 * Evolution API v2: GET /group/groupInfo/{instanceName}/{groupJid}
 * Retorna o nome do grupo (subject) e outros metadados.
 *
 * Caso o endpoint específico não exista (ex: versão mais antiga),
 * faz fallback para fetchGroups + filtro.
 */
export async function fetchGroupInfo(
  instanceName: string,
  groupJid: string,
): Promise<{ jid: string; name: string } | null> {
  // Tenta endpoint específico primeiro (Evolution API v2+)
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/group/groupInfo/${instanceName}/${encodeURIComponent(groupJid)}`,
      {
        method: 'GET',
        headers: headers(),
      },
    );

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      // Resposta pode ser { jid, subject, name, ... } ou { id, subject, ... }
      const jid = String(data.jid ?? data.id ?? '');
      const name = String(data.name ?? data.subject ?? '');
      if (jid && name) {
        return { jid, name };
      }
    }
  } catch {
    // Fallback silencioso para fetchGroups
  }

  // Fallback: busca todos os grupos e filtra pelo JID
  try {
    const result = await fetchGroups(instanceName);
    if (!result.success || !result.groups) return null;
    return result.groups.find((g) => g.jid === groupJid) ?? null;
  } catch {
    return null;
  }
}

/** 
 * Extrai caption de mensagens efêmeras (ephemeralMessage).
 * Evolution API v2: mensagens com tempo de expiração usam este formato.
 */
function extractEphemeralCaption(msg: Record<string, unknown> | undefined): string | undefined {
  if (!msg) return undefined;
  
  // ephemeralMessage > message > {imageMessage|videoMessage|documentMessage}.caption
  const ephemeral = msg.ephemeralMessage as Record<string, unknown> | undefined;
  if (!ephemeral) return undefined;
  
  const innerMsg = ephemeral.message as Record<string, unknown> | undefined;
  if (!innerMsg) return undefined;
  
  // Tenta imageMessage > caption
  const imgMsg = innerMsg.imageMessage as Record<string, unknown> | undefined;
  if (imgMsg?.caption) return String(imgMsg.caption);
  
  // Tenta videoMessage > caption
  const vidMsg = innerMsg.videoMessage as Record<string, unknown> | undefined;
  if (vidMsg?.caption) return String(vidMsg.caption);
  
  // Tenta documentMessage > caption
  const docMsg = innerMsg.documentMessage as Record<string, unknown> | undefined;
  if (docMsg?.caption) return String(docMsg.caption);
  
  // Tenta conversation direta dentro da ephemeral
  if (innerMsg.conversation) return String(innerMsg.conversation);
  
  // Tenta extendedTextMessage
  const extMsg = innerMsg.extendedTextMessage as Record<string, unknown> | undefined;
  if (extMsg?.text) return String(extMsg.text);

  // Tenta audioMessage
  const audMsg = innerMsg.audioMessage as Record<string, unknown> | undefined;
  if (audMsg?.caption) return String(audMsg.caption);
  
  return undefined;
}

/**
 * Extrai caption de mensagens de mídia NÃO efêmeras.
 * Mensagens comuns de imagem/vídeo/documento sem disappearing messages.
 */
function extractMediaCaption(msg: Record<string, unknown> | undefined): string | undefined {
  if (!msg) return undefined;

  // imageMessage > caption
  const imgMsg = msg.imageMessage as Record<string, unknown> | undefined;
  if (imgMsg?.caption) return String(imgMsg.caption);

  // videoMessage > caption
  const vidMsg = msg.videoMessage as Record<string, unknown> | undefined;
  if (vidMsg?.caption) return String(vidMsg.caption);

  // documentMessage > caption
  const docMsg = msg.documentMessage as Record<string, unknown> | undefined;
  if (docMsg?.caption) return String(docMsg.caption);

  // audioMessage (voice/podcast) > caption
  const audMsg = msg.audioMessage as Record<string, unknown> | undefined;
  if (audMsg?.caption) return String(audMsg.caption);

  return undefined;
}

/**
 * Busca mensagens recentes de um grupo ou chat específico.
 *
 * Evolution API v2: POST /chat/findMessages/{instanceName}
 * Retorna a lista de mensagens com text, timestamp, etc.
 */
export async function fetchGroupMessages(
  instanceName: string,
  groupJid: string,
  limit: number = 30,
): Promise<{
  success: boolean;
  messages?: { text?: string; timestamp?: number }[];
  error?: string;
}> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/findMessages/${instanceName}`,
      {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          jid: groupJid,
          count: limit,
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    const data = (await res.json()) as Record<string, unknown>;

    // Evolution API v2 retorna a lista de mensagens de várias formas:
    // 1. Direto como array no root
    // 2. Dentro de { messages: [...] } (array direto)
    // 3. Dentro de { messages: { records: [...] } } (objeto paginado)
    // 4. Dentro de uma chave com nome da instância
    let messageList: unknown[] = [];

    if (Array.isArray(data)) {
      messageList = data;
    } else if (Array.isArray(data.messages)) {
      messageList = data.messages as unknown[];
    } else if (data.messages && typeof data.messages === 'object') {
      // Formato paginado: { messages: { records: [...], total, pages } }
      const msgObj = data.messages as Record<string, unknown>;
      if (Array.isArray(msgObj.records)) {
        messageList = msgObj.records as unknown[];
      }
    }

    // Se ainda não encontrou, tenta extrair de qualquer chave que tenha array
    if (messageList.length === 0) {
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          messageList = data[key] as unknown[];
          break;
        }
      }
    }

    // Garante que respeitamos o limite solicitado, mesmo que a Evolution API
    // retorne mais itens que o `count` enviado.
    if (messageList.length > limit) {
      console.log(
        `[fetchGroupMessages] Evolution API retornou ${messageList.length} itens para count=${limit}. Cortando para ${limit}.`,
      );
      messageList = messageList.slice(0, limit);
    }

    const messages = messageList
      .map((m) => {
        const item = m as Record<string, unknown>;
        // Extrai texto da mensagem — pode estar em diferentes campos
        const msg = item.message as Record<string, unknown> | undefined;
        const text = String(
          item.text ??
            msg?.conversation ??
            (msg?.extendedTextMessage as Record<string, unknown> | undefined)?.text ??
            // Caption de mídia não efêmera (imageMessage/videoMessage/documentMessage)
            extractMediaCaption(msg) ??
            // Mensagens efêmeras (ephemeralMessage) com caption em imageMessage/videoMessage
            extractEphemeralCaption(msg) ??
            '',
        );
        const timestamp = item.messageTimestamp
          ? Number(item.messageTimestamp)
          : undefined;
        return { text: text || '', timestamp };
      })
      .filter((m) => m.text.length > 0);

    return { success: true, messages };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao buscar mensagens do grupo',
    };
  }
}

/**
 * Logout/logout da instância sem deletar.
 */
export async function logoutInstance(instanceName: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: headers(),
    });

    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${text}` };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao fazer logout',
    };
  }
}

/**
 * createInstanceWithQR — Cria instância e garante QR code retornado.
 *
 * Chama createInstance() e, se qrcode.base64 vier null, faz fallback
 * a getQrCode().
 *
 * Retorno: { success, instance?, qrcode?, error? }
 * - success = true → qrcode NUNCA é null (ou error é preenchido)
 * - success = false → detalhe em error
 */
export async function createInstanceWithQR(
  instanceName: string,
): Promise<{
  success: boolean;
  instance?: { instanceName: string; status: string };
  qrcode?: QrCodeResult;
  error?: string;
}> {
  // Tenta criar instância normalmente
  const result = await createInstance(instanceName);

  if (!result.success) {
    return result; // erro real, propaga
  }

  // Se veio QR, retorna direto
  if (result.qrcode?.base64) {
    return result;
  }

  // QR veio null — faz fallback buscando QR diretamente
  const qrFallback = await getQrCode(instanceName);

  if (qrFallback.success && qrFallback.qrcode?.base64) {
    return {
      success: true,
      instance: result.instance,
      qrcode: qrFallback.qrcode,
    };
  }

  // QR ausente mesmo após fallback — retorna erro
  return {
    success: false,
    error: 'QR code não disponível. A instância pode já estar conectada ou o QR expirou.',
  };
}

/**
 * refreshInstance — Ciclo completo de renovação de instância.
 *
 * Fluxo: 1. logoutInstance  →  2. deleteInstance  →  3. createInstanceWithQR
 *
 * Se a Evolution retornar "already in use", repete o ciclo (logout + delete
 * + create). Pode ser chamada de qualquer rota sem se preocupar com o
 * estado atual da instância.
 *
 * Retorno: { success, instance?, qrcode?, error? }
 */
export async function refreshInstance(
  instanceName: string,
): Promise<{
  success: boolean;
  instance?: { instanceName: string; status: string };
  qrcode?: QrCodeResult;
  error?: string;
}> {
  // ─── 1. Logout + Delete (ignora 404) ───────────────────────────
  await logoutInstance(instanceName);
  await deleteInstance(instanceName);

  // ─── 2. Aguarda liberação do nome + Cria com QR ─────────────────
  await sleep(2000);
  const result = await createInstanceWithQR(instanceName);

  // ─── 3. Se "already in use", repete ciclo ─────────────────────
  if (!result.success && result.error?.includes('already in use')) {
    await logoutInstance(instanceName);
    await deleteInstance(instanceName);
    await sleep(2000);
    return await createInstanceWithQR(instanceName);
  }

  return result;
}

/**
 * Envia mensagem de texto para um grupo via Evolution API.
 *
 * POST /message/sendText/{instanceName}
 * O campo "number" aceita JID de grupo (ex: "120363123456789@g.us").
 */
export async function sendGroupMessage(
  instanceName: string,
  groupJid: string,
  text: string,
  delayMs: number = 2000,
): Promise<{
  success: boolean;
  key?: { id: string; remoteJid: string };
  status?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        number: groupJid,
        text,
        delay: delayMs,
        linkPreview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Evolution API retornou HTTP ${res.status}: ${body}` };
    }

    const data = (await res.json()) as {
      key?: { id: string; remoteJid: string };
      status?: string;
    };

    return {
      success: true,
      key: data.key,
      status: data.status,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao enviar mensagem para o grupo',
    };
  }
}
