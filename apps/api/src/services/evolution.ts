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

    const data = (await res.json()) as { state?: { connectionState?: string } };

    const rawState = data.state?.connectionState;
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
 * Evolution API v2: POST /chat/fetchAllGroups/{instanceName}
 * Retorna lista de grupos com jid, name, etc.
 */
export async function fetchGroups(instanceName: string): Promise<{
  success: boolean;
  groups?: { jid: string; name: string }[];
  error?: string;
}> {
  try {
    const res = await fetch(
      `${EVOLUTION_API_URL}/chat/fetchAllGroups/${instanceName}`,
      {
        method: 'POST',
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
 * Busca mensagens recentes de um grupo ou chat específico.
 *
 * Evolution API v2: POST /message/fetchAll/{instanceName}
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
      `${EVOLUTION_API_URL}/message/fetchAll/${instanceName}`,
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
    // 2. Dentro de uma chave com nome da instância
    // 3. Dentro de { messages: [...] }
    let messageList: unknown[] = [];

    if (Array.isArray(data)) {
      messageList = data;
    } else if (Array.isArray(data.messages)) {
      messageList = data.messages as unknown[];
    } else {
      // Tenta extrair de qualquer chave que tenha array
      for (const key of Object.keys(data)) {
        if (Array.isArray(data[key])) {
          messageList = data[key] as unknown[];
          break;
        }
      }
    }

    const messages = messageList
      .map((m) => {
        const item = m as Record<string, unknown>;
        // Extrai texto da mensagem — pode estar em diferentes campos
        const msg = item.message as Record<string, unknown> | undefined;
        const text = String(
          item.text ?? msg?.conversation ?? (msg?.extendedTextMessage as Record<string, unknown> | undefined)?.text ?? '',
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
