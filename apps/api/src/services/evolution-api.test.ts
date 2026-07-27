/**
 * Testes das funções de I/O do cliente Evolution API (evolution.ts).
 *
 * Não batemos na Evolution real — mockamos o `fetch` global para cobrir
 * os callers HTTP (createInstance, getQrCode, getConnectionState,
 * deleteInstance, fetchGroups, fetchGroupInfo, fetchGroupMessages,
 * sendGroupMessage, logoutInstance, createInstanceWithQR, refreshInstance).
 *
 * As funcoes puras (build/parse/normalize) ja estao cobertas em
 * evolution-pure.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { config } from '../config.ts';

// Controle do fetch mockado
let fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
const calls: { url: string; init: RequestInit }[] = [];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(text: string, status = 200): Response {
  return new Response(text, { status });
}

beforeEach(() => {
  calls.length = 0;
  // Default: resposta de create com instance + qrcode (casos simples).
  fetchImpl = async () =>
    jsonResponse({
      instance: { instanceName: 'user-1', status: 'connecting' },
      qrcode: { base64: 'B64', code: 'c', pairingCode: null },
    });
  // Sempre registra a chamada; o fetchImpl só decide o corpo da resposta.
  // @ts-expect-error sobrescreve fetch global em teste
  globalThis.fetch = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  };
});

afterEach(() => {
  // @ts-expect-error restaura fetch
  globalThis.fetch = undefined;
  config.reset();
});

describe('createInstance', () => {
  it('POST /instance/create com body correto', async () => {
    const res = await (await import('./evolution.ts')).createInstance('user-1');
    expect(res.success).toBe(true);
    const call = calls[calls.length - 1]!;
    expect(call.url).toContain('/instance/create');
    expect(call.init.method).toBe('POST');
    const body = JSON.parse(call.init.body as string);
    expect(body.instanceName).toBe('user-1');
    expect(res.instance).toBeDefined();
  });

  it('erro HTTP → success false com mensagem', async () => {
    fetchImpl = async () => textResponse('boom', 500);
    const res = await (await import('./evolution.ts')).createInstance('user-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('HTTP 500');
  });

  it('fetch lança → erro capturado', async () => {
    fetchImpl = async () => {
      throw new Error('net down');
    };
    const res = await (await import('./evolution.ts')).createInstance('user-1');
    expect(res.success).toBe(false);
    expect(res.error).toBe('net down');
  });
});

describe('getQrCode', () => {
  it('GET /instance/qrcode/{name}', async () => {
    const res = await (await import('./evolution.ts')).getQrCode('user-1');
    expect(res.success).toBe(true);
    const call = calls[calls.length - 1]!;
    expect(call.url).toContain('/instance/qrcode/user-1');
    expect(call.init.method).toBe('GET');
  });

  it('erro HTTP → success false', async () => {
    fetchImpl = async () => textResponse('nope', 404);
    const res = await (await import('./evolution.ts')).getQrCode('user-1');
    expect(res.success).toBe(false);
  });
});

describe('getConnectionState', () => {
  it('GET /instance/connectionState/{name}', async () => {
    const res = await (await import('./evolution.ts')).getConnectionState('user-1');
    expect(res.success).toBe(true);
    expect(res.state?.instanceName).toBe('user-1');
  });

  it('erro HTTP → success false', async () => {
    fetchImpl = async () => textResponse('err', 500);
    const res = await (await import('./evolution.ts')).getConnectionState('user-1');
    expect(res.success).toBe(false);
  });
});

describe('deleteInstance', () => {
  it('DELETE /instance/delete/{name} — sucesso', async () => {
    const res = await (await import('./evolution.ts')).deleteInstance('user-1');
    expect(res.success).toBe(true);
    const call = calls[calls.length - 1]!;
    expect(call.url).toContain('/instance/delete/user-1');
    expect(call.init.method).toBe('DELETE');
  });

  it('404 é aceito (isDeleteStatusAcceptable)', async () => {
    fetchImpl = async () => textResponse('gone', 404);
    const res = await (await import('./evolution.ts')).deleteInstance('user-1');
    expect(res.success).toBe(true);
  });

  it('500 → falha', async () => {
    fetchImpl = async () => textResponse('err', 500);
    const res = await (await import('./evolution.ts')).deleteInstance('user-1');
    expect(res.success).toBe(false);
  });
});

describe('logoutInstance', () => {
  it('DELETE /instance/logout/{name}', async () => {
    const res = await (await import('./evolution.ts')).logoutInstance('user-1');
    expect(res.success).toBe(true);
    const call = calls[calls.length - 1]!;
    expect(call.url).toContain('/instance/logout/user-1');
  });

  it('404 aceito', async () => {
    fetchImpl = async () => textResponse('gone', 404);
    const res = await (await import('./evolution.ts')).logoutInstance('user-1');
    expect(res.success).toBe(true);
  });
});

describe('fetchGroups', () => {
  it('GET /group/fetchAllGroups/{name} normaliza grupos', async () => {
    fetchImpl = async () =>
      jsonResponse([
        { id: '1@g.us', subject: 'G1' },
        { id: '2@g.us', subject: 'G2' },
      ]);
    const res = await (await import('./evolution.ts')).fetchGroups('user-1');
    expect(res.success).toBe(true);
    expect(res.groups).toEqual([
      { jid: '1@g.us', name: 'G1' },
      { jid: '2@g.us', name: 'G2' },
    ]);
  });

  it('erro HTTP → success false', async () => {
    fetchImpl = async () => textResponse('err', 500);
    const res = await (await import('./evolution.ts')).fetchGroups('user-1');
    expect(res.success).toBe(false);
  });
});

describe('fetchGroupInfo', () => {
  it('endpoint específico retorna info', async () => {
    fetchImpl = async () => jsonResponse({ jid: '1@g.us', subject: 'Grupo' });
    const res = await (await import('./evolution.ts')).fetchGroupInfo('user-1', '1@g.us');
    expect(res).toEqual({ jid: '1@g.us', name: 'Grupo' });
  });

  it('fallback para fetchGroups quando específico falha', async () => {
    let first = true;
    fetchImpl = async (url: string) => {
      if (first && url.includes('/group/groupInfo/')) {
        first = false;
        return textResponse('err', 500);
      }
      // fetchGroups
      return jsonResponse([{ id: '1@g.us', subject: 'Grupo' }]);
    };
    const res = await (await import('./evolution.ts')).fetchGroupInfo('user-1', '1@g.us');
    expect(res).toEqual({ jid: '1@g.us', name: 'Grupo' });
  });

  it('null quando grupo não encontrado no fallback', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/group/groupInfo/')) return textResponse('err', 500);
      return jsonResponse([{ id: 'other@g.us', subject: 'Outro' }]);
    };
    const res = await (await import('./evolution.ts')).fetchGroupInfo('user-1', '1@g.us');
    expect(res).toBeNull();
  });
});

describe('fetchGroupMessages', () => {
  it('POST /chat/findMessages filtra por grupo', async () => {
    fetchImpl = async () =>
      jsonResponse({
        messages: [
          { key: { remoteJid: '1@g.us' }, message: { conversation: 'oi' } },
          { key: { remoteJid: '2@g.us' }, message: { conversation: 'outro' } },
        ],
      });
    const res = await (await import('./evolution.ts')).fetchGroupMessages('user-1', '1@g.us', 30);
    expect(res.success).toBe(true);
    expect(res.messages).toHaveLength(1);
    expect(res.messages![0]!.text).toBe('oi');
  });

  it('erro HTTP → success false', async () => {
    fetchImpl = async () => textResponse('err', 500);
    const res = await (await import('./evolution.ts')).fetchGroupMessages('user-1', '1@g.us');
    expect(res.success).toBe(false);
  });
});

describe('sendGroupMessage', () => {
  it('POST /message/sendText/{name}', async () => {
    fetchImpl = async () =>
      jsonResponse({ key: { id: 'm1', remoteJid: '1@g.us' }, status: 'PENDING' });
    const res = await (await import('./evolution.ts')).sendGroupMessage('user-1', '1@g.us', 'oi');
    expect(res.success).toBe(true);
    expect(res.key?.id).toBe('m1');
    expect(res.status).toBe('PENDING');
    const call = calls[calls.length - 1]!;
    expect(call.url).toContain('/message/sendText/user-1');
  });

  it('erro HTTP → success false', async () => {
    fetchImpl = async () => textResponse('err', 500);
    const res = await (await import('./evolution.ts')).sendGroupMessage('user-1', '1@g.us', 'oi');
    expect(res.success).toBe(false);
  });
});

describe('createInstanceWithQR', () => {
  it('retorna qrcode quando createInstance traz', async () => {
    fetchImpl = async () =>
      jsonResponse({
        instance: { instanceName: 'user-1', status: 'connecting' },
        qrcode: { base64: 'B64', code: 'c', pairingCode: null },
      });
    const res = await (await import('./evolution.ts')).createInstanceWithQR('user-1');
    expect(res.success).toBe(true);
    expect(res.qrcode?.base64).toBe('B64');
  });

  it('fallback getQrCode quando create retorna base64 null', async () => {
    let count = 0;
    fetchImpl = async (url: string) => {
      if (url.includes('/instance/create')) {
        return jsonResponse({
          instance: { instanceName: 'user-1', status: 'connecting' },
          qrcode: { base64: null },
        });
      }
      count++;
      // getQrCode
      return jsonResponse({ base64: 'FALLBACK', code: 'c', pairingCode: null });
    };
    const res = await (await import('./evolution.ts')).createInstanceWithQR('user-1');
    expect(res.success).toBe(true);
    expect(res.qrcode?.base64).toBe('FALLBACK');
    expect(count).toBe(1);
  });

  it('erro quando QR ausente após fallback', async () => {
    fetchImpl = async (url: string) => {
      if (url.includes('/instance/create')) {
        return jsonResponse({
          instance: { instanceName: 'user-1', status: 'connecting' },
          qrcode: { base64: null },
        });
      }
      return jsonResponse({ base64: null, code: null, pairingCode: null });
    };
    const res = await (await import('./evolution.ts')).createInstanceWithQR('user-1');
    expect(res.success).toBe(false);
    expect(res.error).toContain('QR code não disponível');
  });

  it('propaga erro de createInstance', async () => {
    fetchImpl = async () => textResponse('err', 500);
    const res = await (await import('./evolution.ts')).createInstanceWithQR('user-1');
    expect(res.success).toBe(false);
  });
});

describe('refreshInstance', () => {
  it('ciclo completo: logout → delete → create com QR', async () => {
    fetchImpl = async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        return jsonResponse({
          instance: { instanceName: 'user-1', status: 'connecting' },
          qrcode: { base64: 'B64' },
        });
      }
      return jsonResponse({});
    };
    const res = await (await import('./evolution.ts')).refreshInstance('user-1');
    expect(res.success).toBe(true);
    // logout + delete + create = 3 calls
    expect(calls.filter((c) => c.init.method === 'DELETE')).toHaveLength(2);
    expect(calls.filter((c) => c.init.method === 'POST')).toHaveLength(1);
  });

  it('repete ciclo quando "already in use"', async () => {
    let createCalls = 0;
    fetchImpl = async (url: string, init: RequestInit) => {
      if (init.method === 'POST') {
        createCalls++;
        if (createCalls === 1) {
          return textResponse('This name is already in use.', 500);
        }
        return jsonResponse({
          instance: { instanceName: 'user-1', status: 'connecting' },
          qrcode: { base64: 'B64' },
        });
      }
      return jsonResponse({});
    };
    const res = await (await import('./evolution.ts')).refreshInstance('user-1');
    expect(res.success).toBe(true);
    expect(createCalls).toBe(2);
  });
});
