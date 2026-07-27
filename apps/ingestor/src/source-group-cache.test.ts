/**
 * Testes da função PURA `parseSourceGroupConfigs` (e `sourceGroupCacheKey`)
 * em apps/ingestor/src/source-group-cache.ts.
 *
 * Cobrem 100% do parse/filtro do payload do Redis sem precisar de Redis.
 * A I/O (get + catch de degradação) vive em `getSourceGroupConfigs`.
 */
import { describe, expect, it } from 'bun:test';
import type { SourceGroupConfig } from '@omestre/shared';
import { sourceGroupCacheKey, parseSourceGroupConfigs } from './source-group-cache.ts';

// Helper: constrói um objeto mínimo que satisfaz o filtro de config completa.
// O `parseSourceGroupConfigs` só exige `instanceName` + `targetGroupJid`
// (semântica truthy), então os testes usam essa forma enxuta.
function cfg(instanceName: string, targetGroupJid: string): SourceGroupConfig {
  return { instanceName, targetGroupJid } as SourceGroupConfig;
}

describe('sourceGroupCacheKey', () => {
  it('prefixa o jid com MIRROR_SOURCE_GROUP_CACHE_PREFIX', () => {
    expect(sourceGroupCacheKey('123@g.us')).toBe('mirror:source-group:123@g.us');
  });
});

describe('parseSourceGroupConfigs', () => {
  it('retorna [] quando raw é null', () => {
    expect(parseSourceGroupConfigs(null)).toEqual([]);
  });

  it('retorna [] quando raw é undefined', () => {
    expect(parseSourceGroupConfigs(undefined)).toEqual([]);
  });

  it('retorna [] quando raw é string vazia', () => {
    expect(parseSourceGroupConfigs('')).toEqual([]);
  });

  it('faz parse de um array JSON de configs completos', () => {
    const raw = JSON.stringify([
      { instanceName: 'user-1', targetGroupJid: 'a@g.us' },
      { instanceName: 'user-2', targetGroupJid: 'b@g.us' },
    ]);
    expect(parseSourceGroupConfigs(raw)).toEqual([
      cfg('user-1', 'a@g.us'),
      cfg('user-2', 'b@g.us'),
    ]);
  });

  it('faz parse de um objeto único (não-array) envolvendo em array', () => {
    const raw = JSON.stringify({ instanceName: 'user-9', targetGroupJid: 'z@g.us' });
    expect(parseSourceGroupConfigs(raw)).toEqual([cfg('user-9', 'z@g.us')]);
  });

  it('remove configs sem instanceName', () => {
    const raw = JSON.stringify([
      { targetGroupJid: 'a@g.us' },
      { instanceName: 'user-2', targetGroupJid: 'b@g.us' },
    ]);
    expect(parseSourceGroupConfigs(raw)).toEqual([cfg('user-2', 'b@g.us')]);
  });

  it('remove configs sem targetGroupJid', () => {
    const raw = JSON.stringify([
      { instanceName: 'user-1' },
      { instanceName: 'user-2', targetGroupJid: 'b@g.us' },
    ]);
    expect(parseSourceGroupConfigs(raw)).toEqual([cfg('user-2', 'b@g.us')]);
  });

  it('remove configs com instanceName vazio (truthy)', () => {
    const raw = JSON.stringify([
      { instanceName: '', targetGroupJid: 'a@g.us' },
      { instanceName: 'user-2', targetGroupJid: 'b@g.us' },
    ]);
    expect(parseSourceGroupConfigs(raw)).toEqual([cfg('user-2', 'b@g.us')]);
  });

  it('remove configs com targetGroupJid falsy', () => {
    const raw = JSON.stringify([
      { instanceName: 'user-1', targetGroupJid: null },
      { instanceName: 'user-2', targetGroupJid: 'b@g.us' },
    ]);
    expect(parseSourceGroupConfigs(raw)).toEqual([cfg('user-2', 'b@g.us')]);
  });

  it('retorna [] para JSON inválido', () => {
    expect(parseSourceGroupConfigs('{ não é json')).toEqual([]);
  });

  it('retorna [] quando o JSON é um scalar (não objeto)', () => {
    expect(parseSourceGroupConfigs('42')).toEqual([]);
  });

  it('mantém apenas os completos em um array misto', () => {
    const raw = JSON.stringify([
      { instanceName: 'user-1', targetGroupJid: 'a@g.us' },
      { foo: 'bar' },
      { instanceName: '', targetGroupJid: 'c@g.us' },
      null,
    ]);
    expect(parseSourceGroupConfigs(raw)).toEqual([cfg('user-1', 'a@g.us')]);
  });
});
