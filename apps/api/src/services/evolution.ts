/**
 * Cliente para Evolution API v2.
 *
 * Gerencia o ciclo de vida de instâncias WhatsApp:
 *   create → connect (QR code) → status → disconnect
 *
 * A Evolution API roda no container evolution_api e é exposta
 * na porta EVOLUTION_API_PORT (default 5444) no host.
 */

import { makeLogger } from '@omestre/shared';
import { config } from '../config.ts';
import {
  buildCreateInstanceBody,
  buildEvolutionHeaders,
  buildEvolutionUrl,
  buildFindMessagesBody,
  buildSendTextBody,
  buildSendMediaBody,
  evolutionEndpoints,
  extractGroupList,
  extractMessageList,
  filterAndLimitMessages,
  httpErrorMessage,
  isDeleteStatusAcceptable,
  isInstanceAlreadyInUseError,
  normalizeGroupsForInstance,
  normalizeMessages,
  parseConnectionState,
  parseCreateInstanceResponse,
  parseGroupInfo,
  parseQrCode,
  parseSendTextResponse,
} from './evolution-pure.ts';
import type { QrCodeResult } from './evolution-pure.ts';

export type { QrCodeResult } from './evolution-pure.ts';

const log = makeLogger('api');

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
  return buildEvolutionHeaders(config.EVOLUTION_API_KEY);
}

/** URL completa de um endpoint da Evolution API. */
function url(path: string): string {
  return buildEvolutionUrl(config.EVOLUTION_API_URL, path);
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
    const res = await fetch(url(evolutionEndpoints.createInstance()), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(
        buildCreateInstanceBody(instanceName, config.EVOLUTION_API_KEY, config.WEBHOOK_URL),
      ),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: httpErrorMessage(res.status, text) };
    }

    const data = (await res.json()) as Record<string, unknown>;
    return { success: true, ...parseCreateInstanceResponse(data) };
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
    const res = await fetch(url(evolutionEndpoints.qrCode(instanceName)), {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: httpErrorMessage(res.status, text) };
    }

    const data = (await res.json()) as Record<string, unknown>;

    return {
      success: true,
      qrcode: parseQrCode(data),
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
    const res = await fetch(url(evolutionEndpoints.connectionState(instanceName)), {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: httpErrorMessage(res.status, text) };
    }

    const data = (await res.json()) as {
      state?: { connectionState?: string };
      instance?: { state?: string };
    };

    return {
      success: true,
      state: { instanceName, state: parseConnectionState(data) },
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
    const res = await fetch(url(evolutionEndpoints.deleteInstance(instanceName)), {
      method: 'DELETE',
      headers: headers(),
    });

    if (!isDeleteStatusAcceptable(res.ok, res.status)) {
      const text = await res.text();
      return { success: false, error: httpErrorMessage(res.status, text) };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao desconectar instância',
    };
  }
}

async function fetchInstanceOwnerJid(instanceName: string): Promise<string | null> {
  try {
    const res = await fetch(url(evolutionEndpoints.fetchInstances()), {
      method: 'GET',
      headers: headers(),
    });
    if (!res.ok) return null;

    const instances = (await res.json()) as unknown;
    if (!Array.isArray(instances)) return null;
    const instance = instances.find((candidate) => {
      const item = candidate as Record<string, unknown>;
      return item.name === instanceName || item.instanceName === instanceName;
    }) as Record<string, unknown> | undefined;
    return typeof instance?.ownerJid === 'string' ? instance.ownerJid : null;
  } catch {
    return null;
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
  groups?: { jid: string; name: string; isAdmin: boolean; pictureUrl: string | null }[];
  error?: string;
}> {
  try {
    const res = await fetch(url(evolutionEndpoints.fetchGroups(instanceName)), {
      method: 'GET',
      headers: headers(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: httpErrorMessage(res.status, text) };
    }

    const raw = (await res.json()) as Record<string, unknown>;
    const ownerJid = await fetchInstanceOwnerJid(instanceName);
    const groups = normalizeGroupsForInstance(extractGroupList(raw), ownerJid);

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
    const res = await fetch(url(evolutionEndpoints.groupInfo(instanceName, groupJid)), {
      method: 'GET',
      headers: headers(),
    });

    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      // Resposta pode ser { jid, subject, name, ... } ou { id, subject, ... }
      const info = parseGroupInfo(data);
      if (info) return info;
    }
  } catch {
    // Fallback silencioso para fetchGroups
  }

  // Fallback: busca todos os grupos e filtra pelo JID
  try {
    const result = await fetchGroups(instanceName);
    if (!result.success || !result.groups) return null;
    const group = result.groups.find((candidate) => candidate.jid === groupJid);
    return group ? { jid: group.jid, name: group.name } : null;
  } catch {
    return null;
  }
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
    const res = await fetch(url(evolutionEndpoints.findMessages(instanceName)), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildFindMessagesBody(groupJid, limit)),
    });

    if (!res.ok) {
      const text = await res.text();
      return { success: false, error: httpErrorMessage(res.status, text) };
    }

    const data = (await res.json()) as Record<string, unknown>;

    // A Evolution API v2 ignora o filtro jid e o count no POST
    // /chat/findMessages — filtramos pelo remoteJid e aplicamos o limite.
    const rawList = extractMessageList(data);
    const messageList = filterAndLimitMessages(rawList, groupJid, limit);
    if (rawList.length > limit) {
      console.log(
        `[fetchGroupMessages] Evolution API retornou ${rawList.length} itens para count=${limit}. Cortando para ${limit}.`,
      );
    }

    const messages = normalizeMessages(messageList);

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
    const res = await fetch(url(evolutionEndpoints.logoutInstance(instanceName)), {
      method: 'DELETE',
      headers: headers(),
    });

    if (!isDeleteStatusAcceptable(res.ok, res.status)) {
      const text = await res.text();
      return { success: false, error: httpErrorMessage(res.status, text) };
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
export async function createInstanceWithQR(instanceName: string): Promise<{
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
export async function refreshInstance(instanceName: string): Promise<{
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
  if (!result.success && isInstanceAlreadyInUseError(result.error)) {
    await logoutInstance(instanceName);
    await deleteInstance(instanceName);
    await sleep(2000);
    return await createInstanceWithQR(instanceName);
  }

  return result;
}

/**
 * Envia imagem com legenda para um grupo via Evolution API.
 *
 * POST /message/sendMedia/{instanceName}
 * media é uma URL pública da imagem.
 */
export async function sendMediaMessage(
  instanceName: string,
  groupJid: string,
  mediaUrl: string,
  caption: string = '',
  delayMs: number = 2000,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(url(evolutionEndpoints.sendMedia(instanceName)), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildSendMediaBody(groupJid, mediaUrl, caption, delayMs)),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: httpErrorMessage(res.status, body) };
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro ao enviar mídia' };
  }
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
    const res = await fetch(url(evolutionEndpoints.sendText(instanceName)), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(buildSendTextBody(groupJid, text, delayMs)),
    });

    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: httpErrorMessage(res.status, body) };
    }

    const data = (await res.json()) as Record<string, unknown>;

    return {
      success: true,
      ...parseSendTextResponse(data),
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Erro ao enviar mensagem para o grupo',
    };
  }
}
