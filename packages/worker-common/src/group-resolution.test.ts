/**
 * Testes de resolveGroupName (desacoplamento do webhook — opção B).
 * Mocka globalThis.fetch + config (EVOLUTION_API_URL / apikey) sem I/O real.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const calls: { url: string; headers: Record<string, string> }[] = [];
const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls.length = 0;
  mock.module('./config.ts', () => ({
    config: { EVOLUTION_API_URL: 'http://evolution:8080', EVOLUTION_API_KEY: 'k' },
  }));
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    return new Response(JSON.stringify({ jid: '120@g.us', subject: 'Grupo X' }), {
      status: 200,
    });
  }) as typeof fetch;
});

afterEach(() => {
  mock.restore();
  globalThis.fetch = originalFetch;
});

async function load() {
  return (await import('./group-resolution.ts')).resolveGroupName;
}

describe('resolveGroupName', () => {
  it('NAO chama Evolution se cachedName nao vazio', async () => {
    const resolve = await load();
    const name = await resolve('user-1', '120@g.us', 'Meu Grupo');
    expect(name).toBe('Meu Grupo');
    expect(calls.length).toBe(0);
  });

  it('chama Evolution e extrai o nome quando cachedName vazio', async () => {
    const resolve = await load();
    const name = await resolve('user-1', '120@g.us', '');
    expect(name).toBe('Grupo X');
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe('http://evolution:8080/group/groupInfo/user-1/120%40g.us');
    expect(calls[0]!.headers.apikey).toBe('k');
  });

  it('retorna vazio se Evolution falhar (falha silenciosa)', async () => {
    const resolve = await load();
    globalThis.fetch = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const name = await resolve('user-1', '120@g.us', '');
    expect(name).toBe('');
  });

  it('retorna vazio se EVOLUTION_API_URL ausente', async () => {
    mock.module('./config.ts', () => ({
      config: { EVOLUTION_API_URL: '', EVOLUTION_API_KEY: '' },
    }));
    const resolve = await load();
    const name = await resolve('user-1', '120@g.us', '');
    expect(name).toBe('');
    expect(calls.length).toBe(0);
  });
});
