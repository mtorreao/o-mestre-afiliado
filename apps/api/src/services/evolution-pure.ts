/**
 * Funções PURAS do cliente Evolution API.
 *
 * Separa a montagem de URLs/headers/bodies e o parsing/classificação
 * de respostas da camada de I/O (fetch). Todas as funções aqui são
 * síncronas, não dependem de rede e são 100% testáveis.
 *
 * O I/O (fetch) fica em `evolution.ts`, que consome este módulo.
 */

export interface QrCodeResult {
  base64: string | null;
  code: string | null;
  pairingCode: string | null;
}

export type EvolutionConnectionState = 'open' | 'close' | 'connecting';

// ─── URL / headers / bodies ──────────────────────────────────────────

/** Headers padrão de autenticação da Evolution API. */
export function buildEvolutionHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    apikey: apiKey,
  };
}

/** Junta baseUrl + path normalizando barras duplicadas/ausentes. */
export function buildEvolutionUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** Paths dos endpoints da Evolution API v2 usados pela aplicação. */
export const evolutionEndpoints = {
  createInstance: (): string => '/instance/create',
  qrCode: (instanceName: string): string => `/instance/qrcode/${instanceName}`,
  connectionState: (instanceName: string): string => `/instance/connectionState/${instanceName}`,
  deleteInstance: (instanceName: string): string => `/instance/delete/${instanceName}`,
  logoutInstance: (instanceName: string): string => `/instance/logout/${instanceName}`,
  fetchGroups: (instanceName: string): string =>
    `/group/fetchAllGroups/${instanceName}?getParticipants=true`,
  fetchInstances: (): string => '/instance/fetchInstances',
  groupInfo: (instanceName: string, groupJid: string): string =>
    `/group/groupInfo/${instanceName}/${encodeURIComponent(groupJid)}`,
  findMessages: (instanceName: string): string => `/chat/findMessages/${instanceName}`,
  sendText: (instanceName: string): string => `/message/sendText/${instanceName}`,
  sendMedia: (instanceName: string): string => `/message/sendMedia/${instanceName}`,
} as const;

/** Body do POST /instance/create (inclui webhook per-instância obrigatório). */
export function buildCreateInstanceBody(
  instanceName: string,
  token: string,
  webhookUrl: string,
  webhookSecret?: string,
): Record<string, unknown> {
  const webhook: Record<string, unknown> = {
    enabled: true,
    url: webhookUrl,
    events: [
      'messages.upsert',
      'connection.update',
      'qrcode.updated',
      'groups.upsert',
      'group-participants.update',
    ],
    byEvents: true,
    base64: false,
  };

  // jwt_key: a Evolution gera JWT HS256 assinado com este secret e envia
  // `Authorization: Bearer <jwt>` em cada POST /webhook/message.
  // O webhook.routes.ts valida o token contra OMA_WEBHOOK_SECRET.
  if (webhookSecret) {
    webhook.headers = { jwt_key: webhookSecret };
  }

  return {
    instanceName,
    token,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: true,
    webhook,
  };
}

/** Body do POST /message/sendText (JID de grupo no campo number). */
export function buildSendTextBody(
  groupJid: string,
  text: string,
  delayMs: number = 2000,
): Record<string, unknown> {
  return {
    number: groupJid,
    text,
    delay: delayMs,
    linkPreview: true,
  };
}

/** Body do POST /message/sendMedia (imagem + legenda). */
export function buildSendMediaBody(
  groupJid: string,
  mediaUrl: string,
  caption: string = '',
  delayMs: number = 2000,
): Record<string, unknown> {
  return {
    number: groupJid,
    mediatype: 'image',
    media: mediaUrl,
    caption: caption || '',
    delay: delayMs,
  };
}

/** Body do POST /chat/findMessages. */
export function buildFindMessagesBody(groupJid: string, count: number): Record<string, unknown> {
  return { jid: groupJid, count };
}

// ─── Classificação de erros ──────────────────────────────────────────

/** Mensagem de erro padrão para respostas HTTP não-ok. */
export function httpErrorMessage(status: number, body: string): string {
  return `Evolution API retornou HTTP ${status}: ${body}`;
}

/** Detecta o erro "name already in use" retornado pelo /instance/create. */
export function isInstanceAlreadyInUseError(error: string | undefined): boolean {
  return Boolean(error?.includes('already in use'));
}

/**
 * Em DELETE (delete/logout de instância), 404 é tratado como sucesso —
 * a instância já não existe, que é o estado desejado.
 */
export function isDeleteStatusAcceptable(ok: boolean, status: number): boolean {
  // 404: já tratado (instance inexistente).
  // 403: Evolution API v2 retorna 403 em DELETE /instance/delete/{instanceName}
  // quando a instância está em 'connecting' ou 'open', causando falha em
  // connect retry com "This name user-1 is already in use".
  return ok || status === 404 || status === 403;
}

// ─── Parsing de respostas ────────────────────────────────────────────

/**
 * Normaliza o estado de conexão da instância.
 * Evolution v2.3.7: { instance: { state } }; versões antigas:
 * { state: { connectionState } }. Qualquer valor desconhecido → 'close'.
 */
export function parseConnectionState(data: {
  state?: { connectionState?: string };
  instance?: { state?: string };
}): EvolutionConnectionState {
  const rawState = data.instance?.state ?? data.state?.connectionState;
  if (rawState === 'open') return 'open';
  if (rawState === 'connecting') return 'connecting';
  return 'close';
}

/** Extrai QrCodeResult de um objeto cru (campos ausentes → null). */
export function parseQrCode(data: Record<string, unknown>): QrCodeResult {
  return {
    base64: (data.base64 as string) ?? null,
    code: (data.code as string) ?? null,
    pairingCode: (data.pairingCode as string) ?? null,
  };
}

/** Parse da resposta do POST /instance/create. */
export function parseCreateInstanceResponse(data: Record<string, unknown>): {
  instance?: { instanceName: string; status: string };
  qrcode?: QrCodeResult;
} {
  const instance = data.instance as Record<string, unknown> | undefined;
  const qrcode = data.qrcode as Record<string, unknown> | undefined;

  return {
    instance: instance
      ? {
          instanceName: String(instance.instanceName ?? ''),
          status: String(instance.status ?? 'close'),
        }
      : undefined,
    qrcode: qrcode ? parseQrCode(qrcode) : undefined,
  };
}

/**
 * Extrai a lista crua de grupos da resposta do fetchAllGroups.
 * Formatos: array direto OU { [instanceName]: [...] }.
 */
export function extractGroupList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (Array.isArray(value)) return value;
    }
  }
  return [];
}

/** Normaliza itens de grupo para { jid, name }, descartando incompletos. */
export function normalizeGroups(groupList: unknown[]): { jid: string; name: string }[] {
  return groupList
    .map((g) => {
      const item = g as Record<string, unknown>;
      const jid = String(item.jid ?? item.id ?? '');
      const name = String(item.name ?? item.subject ?? '');
      return { jid, name };
    })
    .filter((g) => g.jid && g.name);
}

export interface NormalizedWhatsAppGroup {
  jid: string;
  name: string;
  isAdmin: boolean;
  pictureUrl: string | null;
}

function participantMatchesInstance(
  participant: Record<string, unknown>,
  instanceOwnerJid: string,
): boolean {
  return participant.id === instanceOwnerJid || participant.phoneNumber === instanceOwnerJid;
}

/**
 * Normaliza grupos preservando se a conta conectada é admin do grupo.
 * `admin` da Evolution pode ser "admin", "superadmin" ou null.
 */
export function normalizeGroupsForInstance(
  groupList: unknown[],
  instanceOwnerJid: string | null,
): NormalizedWhatsAppGroup[] {
  return groupList
    .map((group) => {
      const item = group as Record<string, unknown>;
      const jid = String(item.jid ?? item.id ?? '');
      const name = String(item.name ?? item.subject ?? '');
      const participants = Array.isArray(item.participants) ? item.participants : [];
      const participant = instanceOwnerJid
        ? participants.find((candidate) =>
            participantMatchesInstance(candidate as Record<string, unknown>, instanceOwnerJid),
          )
        : undefined;
      const admin = (participant as Record<string, unknown> | undefined)?.admin;

      return {
        jid,
        name,
        isAdmin: admin === 'admin' || admin === 'superadmin',
        pictureUrl: typeof item.pictureUrl === 'string' && item.pictureUrl ? item.pictureUrl : null,
      };
    })
    .filter((group) => group.jid && group.name);
}

/** Parse da resposta do groupInfo — null se jid/name ausentes. */
export function parseGroupInfo(
  data: Record<string, unknown>,
): { jid: string; name: string } | null {
  const jid = String(data.jid ?? data.id ?? '');
  const name = String(data.name ?? data.subject ?? '');
  return jid && name ? { jid, name } : null;
}

/**
 * Extrai a lista crua de mensagens do POST /chat/findMessages.
 * Formatos suportados:
 *  1. Array direto no root
 *  2. { messages: [...] }
 *  3. { messages: { records: [...] } } (paginado)
 *  4. { [qualquerChave]: [...] }
 */
export function extractMessageList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.messages)) return obj.messages;

  if (obj.messages && typeof obj.messages === 'object') {
    const msgObj = obj.messages as Record<string, unknown>;
    if (Array.isArray(msgObj.records)) return msgObj.records;
  }

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

/**
 * Extrai caption de mensagens de mídia NÃO efêmeras
 * (imageMessage/videoMessage/documentMessage/audioMessage).
 */
export function extractMediaCaption(msg: Record<string, unknown> | undefined): string | undefined {
  if (!msg) return undefined;

  const imgMsg = msg.imageMessage as Record<string, unknown> | undefined;
  if (imgMsg?.caption) return String(imgMsg.caption);

  const vidMsg = msg.videoMessage as Record<string, unknown> | undefined;
  if (vidMsg?.caption) return String(vidMsg.caption);

  const docMsg = msg.documentMessage as Record<string, unknown> | undefined;
  if (docMsg?.caption) return String(docMsg.caption);

  const audMsg = msg.audioMessage as Record<string, unknown> | undefined;
  if (audMsg?.caption) return String(audMsg.caption);

  return undefined;
}

/**
 * Extrai caption/texto de mensagens efêmeras (ephemeralMessage).
 * Evolution API v2: mensagens com tempo de expiração usam este formato.
 */
export function extractEphemeralCaption(
  msg: Record<string, unknown> | undefined,
): string | undefined {
  if (!msg) return undefined;

  const ephemeral = msg.ephemeralMessage as Record<string, unknown> | undefined;
  if (!ephemeral) return undefined;

  const innerMsg = ephemeral.message as Record<string, unknown> | undefined;
  if (!innerMsg) return undefined;

  const imgMsg = innerMsg.imageMessage as Record<string, unknown> | undefined;
  if (imgMsg?.caption) return String(imgMsg.caption);

  const vidMsg = innerMsg.videoMessage as Record<string, unknown> | undefined;
  if (vidMsg?.caption) return String(vidMsg.caption);

  const docMsg = innerMsg.documentMessage as Record<string, unknown> | undefined;
  if (docMsg?.caption) return String(docMsg.caption);

  if (innerMsg.conversation) return String(innerMsg.conversation);

  const extMsg = innerMsg.extendedTextMessage as Record<string, unknown> | undefined;
  if (extMsg?.text) return String(extMsg.text);

  const audMsg = innerMsg.audioMessage as Record<string, unknown> | undefined;
  if (audMsg?.caption) return String(audMsg.caption);

  return undefined;
}

/**
 * Filtra mensagens pelo remoteJid do grupo (a Evolution ignora o filtro
 * jid do body e retorna mensagens de TODOS os grupos) e aplica o limite
 * (a Evolution também ignora o `count`).
 */
export function filterAndLimitMessages(
  messageList: unknown[],
  groupJid: string,
  limit: number,
): unknown[] {
  const filtered = messageList.filter((m) => {
    const item = m as Record<string, unknown>;
    const key = item.key as Record<string, unknown> | undefined;
    return key?.remoteJid === groupJid;
  });
  return filtered.length > limit ? filtered.slice(0, limit) : filtered;
}

/**
 * Normaliza itens crus de mensagem para { text, timestamp },
 * descartando mensagens sem texto extraível.
 */
export function normalizeMessages(messageList: unknown[]): { text: string; timestamp?: number }[] {
  return messageList
    .map((m) => {
      const item = m as Record<string, unknown>;
      const msg = item.message as Record<string, unknown> | undefined;
      const text = String(
        item.text ??
          msg?.conversation ??
          (msg?.extendedTextMessage as Record<string, unknown> | undefined)?.text ??
          extractMediaCaption(msg) ??
          extractEphemeralCaption(msg) ??
          '',
      );
      const timestamp = item.messageTimestamp ? Number(item.messageTimestamp) : undefined;
      return { text: text || '', timestamp };
    })
    .filter((m) => m.text.length > 0);
}

/** Parse da resposta do POST /message/sendText. */
export function parseSendTextResponse(data: Record<string, unknown>): {
  key?: { id: string; remoteJid: string };
  status?: string;
} {
  return {
    key: data.key as { id: string; remoteJid: string } | undefined,
    status: data.status as string | undefined,
  };
}
