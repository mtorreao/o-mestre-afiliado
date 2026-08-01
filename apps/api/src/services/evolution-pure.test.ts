/**
 * Testes das funções PURAS do cliente Evolution API (evolution-pure.ts).
 *
 * Cobre construção de URLs/headers/bodies e parsing/classificação de
 * respostas — sem nenhum fetch real.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildCreateInstanceBody,
  buildEvolutionHeaders,
  buildEvolutionUrl,
  buildFindMessagesBody,
  buildSendMediaBody,
  buildSendTextBody,
  evolutionEndpoints,
  extractEphemeralCaption,
  extractGroupList,
  extractMediaCaption,
  extractMessageList,
  filterAndLimitMessages,
  httpErrorMessage,
  isDeleteStatusAcceptable,
  isInstanceAlreadyInUseError,
  normalizeGroups,
  normalizeGroupsForInstance,
  normalizeMessages,
  parseConnectionState,
  parseCreateInstanceResponse,
  parseGroupInfo,
  parseQrCode,
  parseSendTextResponse,
} from './evolution-pure.ts';

// ─── URLs / headers / bodies ─────────────────────────────────────────

describe('buildEvolutionHeaders', () => {
  it('inclui Content-Type e apikey', () => {
    expect(buildEvolutionHeaders('minha-chave')).toEqual({
      'Content-Type': 'application/json',
      apikey: 'minha-chave',
    });
  });

  it('aceita chave vazia', () => {
    expect(buildEvolutionHeaders('').apikey).toBe('');
  });
});

describe('buildEvolutionUrl', () => {
  it('junta base + path', () => {
    expect(buildEvolutionUrl('http://localhost:5444', '/instance/create')).toBe(
      'http://localhost:5444/instance/create',
    );
  });

  it('normaliza barra final na base', () => {
    expect(buildEvolutionUrl('http://localhost:5444/', '/instance/create')).toBe(
      'http://localhost:5444/instance/create',
    );
  });

  it('adiciona barra ausente no path', () => {
    expect(buildEvolutionUrl('http://localhost:5444', 'instance/create')).toBe(
      'http://localhost:5444/instance/create',
    );
  });
});

describe('evolutionEndpoints', () => {
  it('createInstance', () => {
    expect(evolutionEndpoints.createInstance()).toBe('/instance/create');
  });

  it('qrCode inclui instanceName', () => {
    expect(evolutionEndpoints.qrCode('user-1')).toBe('/instance/qrcode/user-1');
  });

  it('connectionState', () => {
    expect(evolutionEndpoints.connectionState('user-1')).toBe('/instance/connectionState/user-1');
  });

  it('deleteInstance', () => {
    expect(evolutionEndpoints.deleteInstance('user-1')).toBe('/instance/delete/user-1');
  });

  it('logoutInstance', () => {
    expect(evolutionEndpoints.logoutInstance('user-1')).toBe('/instance/logout/user-1');
  });

  it('fetchGroups inclui getParticipants=true', () => {
    expect(evolutionEndpoints.fetchGroups('user-1')).toBe(
      '/group/fetchAllGroups/user-1?getParticipants=true',
    );
  });

  it('fetchInstances lista identidades conectadas', () => {
    expect(evolutionEndpoints.fetchInstances()).toBe('/instance/fetchInstances');
  });

  it('groupInfo faz encode do JID', () => {
    expect(evolutionEndpoints.groupInfo('user-1', '123@g.us')).toBe(
      '/group/groupInfo/user-1/123%40g.us',
    );
  });

  it('findMessages (endpoint v2 correto, não /message/fetchAll)', () => {
    expect(evolutionEndpoints.findMessages('user-1')).toBe('/chat/findMessages/user-1');
  });

  it('sendText', () => {
    expect(evolutionEndpoints.sendText('user-1')).toBe('/message/sendText/user-1');
  });

  it('sendMedia', () => {
    expect(evolutionEndpoints.sendMedia('user-1')).toBe('/message/sendMedia/user-1');
  });
});

describe('buildCreateInstanceBody', () => {
  const body = buildCreateInstanceBody('user-9', 'tok', 'http://api:5442/webhook/message');

  it('inclui instanceName, token e integration Baileys', () => {
    expect(body.instanceName).toBe('user-9');
    expect(body.token).toBe('tok');
    expect(body.integration).toBe('WHATSAPP-BAILEYS');
    expect(body.qrcode).toBe(true);
  });

  it('inclui webhook per-instância habilitado com os 5 eventos', () => {
    const webhook = body.webhook as Record<string, unknown>;
    expect(webhook.enabled).toBe(true);
    expect(webhook.url).toBe('http://api:5442/webhook/message');
    expect(webhook.byEvents).toBe(true);
    expect(webhook.base64).toBe(false);
    expect(webhook.events).toEqual([
      'messages.upsert',
      'connection.update',
      'qrcode.updated',
      'groups.upsert',
      'group-participants.update',
    ]);
  });
});

describe('buildSendTextBody', () => {
  it('usa o JID no campo number com linkPreview e delay default', () => {
    expect(buildSendTextBody('123@g.us', 'oi')).toEqual({
      number: '123@g.us',
      text: 'oi',
      delay: 2000,
      linkPreview: true,
    });
  });

  it('aceita delay custom', () => {
    expect(buildSendTextBody('123@g.us', 'oi', 500).delay).toBe(500);
  });
});

describe('buildFindMessagesBody', () => {
  it('monta jid + count', () => {
    expect(buildFindMessagesBody('123@g.us', 30)).toEqual({ jid: '123@g.us', count: 30 });
  });
});

// ─── Classificação de erros ──────────────────────────────────────────

describe('httpErrorMessage', () => {
  it('formata status + body', () => {
    expect(httpErrorMessage(403, 'forbidden')).toBe('Evolution API retornou HTTP 403: forbidden');
  });
});

describe('isInstanceAlreadyInUseError', () => {
  it('true quando contém "already in use"', () => {
    expect(isInstanceAlreadyInUseError("This name 'user-1' is already in use.")).toBe(true);
  });

  it('false para outro erro', () => {
    expect(isInstanceAlreadyInUseError('HTTP 500: boom')).toBe(false);
  });

  it('false para undefined', () => {
    expect(isInstanceAlreadyInUseError(undefined)).toBe(false);
  });
});

describe('isDeleteStatusAcceptable', () => {
  it('true para res.ok', () => {
    expect(isDeleteStatusAcceptable(true, 200)).toBe(true);
  });

  it('true para 404 (instância já não existe)', () => {
    expect(isDeleteStatusAcceptable(false, 404)).toBe(true);
  });

  it('false para 500', () => {
    expect(isDeleteStatusAcceptable(false, 500)).toBe(false);
  });

  it('false para 403', () => {
    expect(isDeleteStatusAcceptable(false, 403)).toBe(false);
  });
});

// ─── Parsing de respostas ────────────────────────────────────────────

describe('parseConnectionState', () => {
  it('formato v2.3.7: { instance: { state } } — open', () => {
    expect(parseConnectionState({ instance: { state: 'open' } })).toBe('open');
  });

  it('formato v2.3.7 — connecting', () => {
    expect(parseConnectionState({ instance: { state: 'connecting' } })).toBe('connecting');
  });

  it('formato legado: { state: { connectionState } }', () => {
    expect(parseConnectionState({ state: { connectionState: 'open' } })).toBe('open');
  });

  it('formato v2.3.7 tem precedência sobre o legado', () => {
    expect(
      parseConnectionState({
        instance: { state: 'connecting' },
        state: { connectionState: 'open' },
      }),
    ).toBe('connecting');
  });

  it('valor desconhecido → close', () => {
    expect(parseConnectionState({ instance: { state: 'weird' } })).toBe('close');
  });

  it('objeto vazio → close', () => {
    expect(parseConnectionState({})).toBe('close');
  });
});

describe('parseQrCode', () => {
  it('extrai os 3 campos', () => {
    expect(
      parseQrCode({ base64: 'data:image/png;base64,abc', code: 'c', pairingCode: 'p' }),
    ).toEqual({ base64: 'data:image/png;base64,abc', code: 'c', pairingCode: 'p' });
  });

  it('campos ausentes → null', () => {
    expect(parseQrCode({})).toEqual({ base64: null, code: null, pairingCode: null });
  });
});

describe('parseCreateInstanceResponse', () => {
  it('extrai instance + qrcode', () => {
    const result = parseCreateInstanceResponse({
      instance: { instanceName: 'user-1', status: 'connecting' },
      qrcode: { base64: 'b64', code: 'c', pairingCode: null },
    });
    expect(result.instance).toEqual({ instanceName: 'user-1', status: 'connecting' });
    expect(result.qrcode).toEqual({ base64: 'b64', code: 'c', pairingCode: null });
  });

  it('instance ausente → undefined', () => {
    expect(parseCreateInstanceResponse({}).instance).toBeUndefined();
    expect(parseCreateInstanceResponse({}).qrcode).toBeUndefined();
  });

  it('instance sem campos → defaults ("", close)', () => {
    const result = parseCreateInstanceResponse({ instance: {} });
    expect(result.instance).toEqual({ instanceName: '', status: 'close' });
  });
});

describe('extractGroupList', () => {
  it('array direto', () => {
    expect(extractGroupList([{ jid: '1' }])).toEqual([{ jid: '1' }]);
  });

  it('objeto { [instanceName]: [...] }', () => {
    expect(extractGroupList({ 'user-1': [{ jid: '1' }] })).toEqual([{ jid: '1' }]);
  });

  it('objeto sem array → []', () => {
    expect(extractGroupList({ foo: 'bar' })).toEqual([]);
  });

  it('null → []', () => {
    expect(extractGroupList(null)).toEqual([]);
  });
});

describe('normalizeGroups', () => {
  it('normaliza jid/name e aceita id/subject como fallback', () => {
    expect(
      normalizeGroups([
        { jid: '1@g.us', name: 'A' },
        { id: '2@g.us', subject: 'B' },
      ]),
    ).toEqual([
      { jid: '1@g.us', name: 'A' },
      { jid: '2@g.us', name: 'B' },
    ]);
  });

  it('descarta itens sem jid ou sem name', () => {
    expect(normalizeGroups([{ jid: '1@g.us' }, { name: 'X' }, {}])).toEqual([]);
  });
});

describe('normalizeGroupsForInstance', () => {
  const groups = [
    {
      id: 'admin@g.us',
      subject: 'Administrado',
      participants: [
        { phoneNumber: '558193970733@s.whatsapp.net', admin: 'admin' },
        { phoneNumber: '5511999999999@s.whatsapp.net', admin: null },
      ],
    },
    {
      id: 'superadmin@g.us',
      subject: 'Criado pelo usuário',
      participants: [{ phoneNumber: '558193970733@s.whatsapp.net', admin: 'superadmin' }],
    },
    {
      id: 'member@g.us',
      subject: 'Somente membro',
      participants: [{ phoneNumber: '558193970733@s.whatsapp.net', admin: null }],
    },
  ];

  it('marca apenas grupos em que o dono da instância é admin ou superadmin', () => {
    const groups = [
      {
        id: 'admin@g.us',
        subject: 'Administrado',
        pictureUrl: 'https://example.com/admin.png',
        participants: [
          { phoneNumber: '558193970733@s.whatsapp.net', admin: 'admin' },
          { phoneNumber: '5511999999999@s.whatsapp.net', admin: null },
        ],
      },
      {
        id: 'superadmin@g.us',
        subject: 'Criado pelo usuário',
        pictureUrl: 'https://example.com/super.png',
        participants: [{ phoneNumber: '558193970733@s.whatsapp.net', admin: 'superadmin' }],
      },
      {
        id: 'member@g.us',
        subject: 'Somente membro',
        participants: [{ phoneNumber: '558193970733@s.whatsapp.net', admin: null }],
      },
    ];
    expect(normalizeGroupsForInstance(groups, '558193970733@s.whatsapp.net')).toEqual([
      {
        jid: 'admin@g.us',
        name: 'Administrado',
        isAdmin: true,
        pictureUrl: 'https://example.com/admin.png',
      },
      {
        jid: 'superadmin@g.us',
        name: 'Criado pelo usuário',
        isAdmin: true,
        pictureUrl: 'https://example.com/super.png',
      },
      { jid: 'member@g.us', name: 'Somente membro', isAdmin: false, pictureUrl: null },
    ]);
  });

  it('devolve pictureUrl=null quando ausente ou vazio', () => {
    expect(
      normalizeGroupsForInstance(
        [
          { id: 'a@g.us', subject: 'A', participants: [] },
          { id: 'b@g.us', subject: 'B', pictureUrl: '', participants: [] },
        ],
        null,
      ),
    ).toEqual([
      { jid: 'a@g.us', name: 'A', isAdmin: false, pictureUrl: null },
      { jid: 'b@g.us', name: 'B', isAdmin: false, pictureUrl: null },
    ]);
  });

  it('compara também pelo id LID quando disponível', () => {
    expect(
      normalizeGroupsForInstance(
        [{ id: 'lid@g.us', subject: 'LID', participants: [{ id: '123@lid', admin: 'admin' }] }],
        '123@lid',
      ),
    ).toEqual([{ jid: 'lid@g.us', name: 'LID', isAdmin: true, pictureUrl: null }]);
  });

  it('não concede administração quando a identidade da instância está ausente', () => {
    expect(normalizeGroupsForInstance(groups, null).every((group) => !group.isAdmin)).toBe(true);
  });
});

describe('parseGroupInfo', () => {
  it('extrai jid + name', () => {
    expect(parseGroupInfo({ jid: '1@g.us', subject: 'Grupo' })).toEqual({
      jid: '1@g.us',
      name: 'Grupo',
    });
  });

  it('usa id como fallback de jid', () => {
    expect(parseGroupInfo({ id: '2@g.us', name: 'G2' })).toEqual({ jid: '2@g.us', name: 'G2' });
  });

  it('retorna null sem jid', () => {
    expect(parseGroupInfo({ subject: 'X' })).toBeNull();
  });

  it('retorna null sem name', () => {
    expect(parseGroupInfo({ jid: '1@g.us' })).toBeNull();
  });
});

describe('extractMessageList', () => {
  it('array no root', () => {
    expect(extractMessageList([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('{ messages: [...] }', () => {
    expect(extractMessageList({ messages: [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it('{ messages: { records: [...] } } (paginado)', () => {
    expect(extractMessageList({ messages: { records: [{ a: 1 }], total: 1, pages: 1 } })).toEqual([
      { a: 1 },
    ]);
  });

  it('fallback: qualquer chave com array', () => {
    expect(extractMessageList({ 'user-1': [{ a: 1 }] })).toEqual([{ a: 1 }]);
  });

  it('objeto sem array → []', () => {
    expect(extractMessageList({ messages: { total: 0 } })).toEqual([]);
  });

  it('null / primitivo → []', () => {
    expect(extractMessageList(null)).toEqual([]);
    expect(extractMessageList('str')).toEqual([]);
  });
});

describe('extractMediaCaption', () => {
  it('imageMessage.caption', () => {
    expect(extractMediaCaption({ imageMessage: { caption: 'img' } })).toBe('img');
  });

  it('videoMessage.caption', () => {
    expect(extractMediaCaption({ videoMessage: { caption: 'vid' } })).toBe('vid');
  });

  it('documentMessage.caption', () => {
    expect(extractMediaCaption({ documentMessage: { caption: 'doc' } })).toBe('doc');
  });

  it('audioMessage.caption', () => {
    expect(extractMediaCaption({ audioMessage: { caption: 'aud' } })).toBe('aud');
  });

  it('undefined para msg sem caption', () => {
    expect(extractMediaCaption({ conversation: 'texto' })).toBeUndefined();
  });

  it('undefined para msg undefined', () => {
    expect(extractMediaCaption(undefined)).toBeUndefined();
  });
});

describe('extractEphemeralCaption', () => {
  const wrap = (inner: Record<string, unknown>) => ({
    ephemeralMessage: { message: inner },
  });

  it('imageMessage.caption dentro da ephemeral', () => {
    expect(extractEphemeralCaption(wrap({ imageMessage: { caption: 'img' } }))).toBe('img');
  });

  it('videoMessage.caption', () => {
    expect(extractEphemeralCaption(wrap({ videoMessage: { caption: 'vid' } }))).toBe('vid');
  });

  it('documentMessage.caption', () => {
    expect(extractEphemeralCaption(wrap({ documentMessage: { caption: 'doc' } }))).toBe('doc');
  });

  it('conversation direta', () => {
    expect(extractEphemeralCaption(wrap({ conversation: 'conv' }))).toBe('conv');
  });

  it('extendedTextMessage.text', () => {
    expect(extractEphemeralCaption(wrap({ extendedTextMessage: { text: 'ext' } }))).toBe('ext');
  });

  it('audioMessage.caption', () => {
    expect(extractEphemeralCaption(wrap({ audioMessage: { caption: 'aud' } }))).toBe('aud');
  });

  it('undefined sem ephemeralMessage', () => {
    expect(extractEphemeralCaption({ conversation: 'x' })).toBeUndefined();
  });

  it('undefined sem message interna', () => {
    expect(extractEphemeralCaption({ ephemeralMessage: {} })).toBeUndefined();
  });

  it('undefined para msg undefined', () => {
    expect(extractEphemeralCaption(undefined)).toBeUndefined();
  });

  it('undefined quando inner não tem texto', () => {
    expect(extractEphemeralCaption(wrap({ stickerMessage: {} }))).toBeUndefined();
  });
});

describe('filterAndLimitMessages', () => {
  const msg = (jid: string, n: number) => ({ key: { remoteJid: jid }, n });

  it('filtra pelo remoteJid do grupo', () => {
    const list = [msg('a@g.us', 1), msg('b@g.us', 2), msg('a@g.us', 3)];
    const result = filterAndLimitMessages(list, 'a@g.us', 10);
    expect(result).toHaveLength(2);
  });

  it('aplica o limite (Evolution ignora o count)', () => {
    const list = Array.from({ length: 50 }, (_, i) => msg('a@g.us', i));
    expect(filterAndLimitMessages(list, 'a@g.us', 30)).toHaveLength(30);
  });

  it('descarta itens sem key', () => {
    expect(filterAndLimitMessages([{ n: 1 }], 'a@g.us', 10)).toHaveLength(0);
  });

  it('lista vazia → []', () => {
    expect(filterAndLimitMessages([], 'a@g.us', 10)).toEqual([]);
  });
});

describe('normalizeMessages', () => {
  it('extrai conversation', () => {
    const result = normalizeMessages([
      { message: { conversation: 'oi' }, messageTimestamp: 1700000000 },
    ]);
    expect(result).toEqual([{ text: 'oi', timestamp: 1700000000 }]);
  });

  it('extrai extendedTextMessage.text', () => {
    const result = normalizeMessages([{ message: { extendedTextMessage: { text: 'ext' } } }]);
    expect(result[0]!.text).toBe('ext');
  });

  it('extrai caption de mídia (imageMessage)', () => {
    const result = normalizeMessages([{ message: { imageMessage: { caption: 'promo' } } }]);
    expect(result[0]!.text).toBe('promo');
  });

  it('extrai caption efêmera', () => {
    const result = normalizeMessages([
      { message: { ephemeralMessage: { message: { imageMessage: { caption: 'ef' } } } } },
    ]);
    expect(result[0]!.text).toBe('ef');
  });

  it('usa item.text quando presente (prioridade máxima)', () => {
    const result = normalizeMessages([{ text: 'direto', message: { conversation: 'x' } }]);
    expect(result[0]!.text).toBe('direto');
  });

  it('descarta mensagens sem texto', () => {
    expect(normalizeMessages([{ message: {} }, {}])).toEqual([]);
  });

  it('timestamp ausente → undefined', () => {
    const result = normalizeMessages([{ message: { conversation: 'oi' } }]);
    expect(result[0]!.timestamp).toBeUndefined();
  });
});

describe('parseSendTextResponse', () => {
  it('extrai key e status', () => {
    expect(
      parseSendTextResponse({ key: { id: 'm1', remoteJid: '1@g.us' }, status: 'PENDING' }),
    ).toEqual({ key: { id: 'm1', remoteJid: '1@g.us' }, status: 'PENDING' });
  });

  it('campos ausentes → undefined', () => {
    expect(parseSendTextResponse({})).toEqual({ key: undefined, status: undefined });
  });
});

describe('buildSendMediaBody', () => {
  it('monta body com image URL e caption', () => {
    expect(
      buildSendMediaBody('123@g.us', 'https://http2.mlstatic.com/img.jpg', '🔥 Oferta!'),
    ).toEqual({
      number: '123@g.us',
      mediatype: 'image',
      media: 'https://http2.mlstatic.com/img.jpg',
      caption: '🔥 Oferta!',
      delay: 2000,
    });
  });

  it('aceita caption vazia', () => {
    const body = buildSendMediaBody('123@g.us', 'https://img.com/foto.jpg');
    expect(body.caption).toBe('');
  });
});
