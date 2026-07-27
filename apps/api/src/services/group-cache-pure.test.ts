/**
 * Testes das funções PURAS do group-cache (group-cache-pure.ts).
 *
 * Sem Redis e sem PostgreSQL — apenas lógica de chave, parsing,
 * montagem de config, diff e dedup.
 */
import { describe, expect, it } from 'bun:test';
import type { SourceGroupConfig } from '@omestre/shared';
import {
  CACHE_PREFIX,
  CACHE_SET_KEY,
  CACHE_TTL,
  buildLegacySourceGroupValue,
  buildSourceGroupConfig,
  diffRemovedGroups,
  firstAffiliateId,
  firstConfig,
  firstTargetGroup,
  groupConfigsByJid,
  instanceNameFromMirror,
  mirrorHasSourceGroup,
  parseCachedSourceGroupConfigs,
  sourceGroupCacheKey,
} from './group-cache-pure.ts';
import type { MirrorLike } from './group-cache-pure.ts';

const baseMirror: MirrorLike = {
  id: 7,
  userId: 3,
  sourceGroups: [{ jid: 'src@g.us', name: 'Origem' }],
  targetGroups: [{ jid: 'tgt@g.us', name: 'Destino' }],
  messageTemplate: '{{link}}',
  subRateLimitMaxMsgs: 5,
  subRateLimitWindowSec: 300,
};

const makeConfig = (mirrorId: number, affiliateId = 1): SourceGroupConfig => ({
  affiliateId,
  mirrorId,
  instanceName: 'user-1',
  targetGroupJid: 'tgt@g.us',
  targetGroupName: 'Destino',
  messageTemplate: null,
  subRateMaxMsgs: 5,
  subRateWindowSec: 300,
});

describe('constantes de cache', () => {
  it('prefixo, set key e TTL de 1h', () => {
    expect(CACHE_PREFIX).toBe('mirror:source-group:');
    expect(CACHE_SET_KEY).toBe('mirror:source-groups:all');
    expect(CACHE_TTL).toBe(3600);
  });
});

describe('sourceGroupCacheKey', () => {
  it('monta a chave com o prefixo', () => {
    expect(sourceGroupCacheKey('123@g.us')).toBe('mirror:source-group:123@g.us');
  });
});

describe('parseCachedSourceGroupConfigs', () => {
  it('formato novo (array) → retorna array', () => {
    const configs = [makeConfig(1)];
    expect(parseCachedSourceGroupConfigs(JSON.stringify(configs))).toEqual(configs);
  });

  it('formato legado (objeto) → converte para array', () => {
    const legacy = { affiliateId: 1, mirrorId: 2, groupName: 'X' };
    const result = parseCachedSourceGroupConfigs(JSON.stringify(legacy));
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('null → null', () => {
    expect(parseCachedSourceGroupConfigs(null)).toBeNull();
  });

  it('string vazia → null', () => {
    expect(parseCachedSourceGroupConfigs('')).toBeNull();
  });

  it('JSON inválido → null', () => {
    expect(parseCachedSourceGroupConfigs('{invalid')).toBeNull();
  });

  it('JSON primitivo (número) → null', () => {
    expect(parseCachedSourceGroupConfigs('42')).toBeNull();
  });
});

describe('instanceNameFromMirror', () => {
  it('deriva user-{userId}', () => {
    expect(instanceNameFromMirror({ userId: 3 })).toBe('user-3');
  });
});

describe('firstTargetGroup', () => {
  it('retorna o primeiro targetGroup', () => {
    expect(firstTargetGroup(baseMirror)).toEqual({ jid: 'tgt@g.us', name: 'Destino' });
  });

  it('null para targetGroups vazio', () => {
    expect(firstTargetGroup({ targetGroups: [] })).toBeNull();
  });

  it('null para targetGroups null', () => {
    expect(firstTargetGroup({ targetGroups: null })).toBeNull();
  });
});

describe('buildSourceGroupConfig', () => {
  it('monta o SourceGroupConfig completo', () => {
    const config = buildSourceGroupConfig(baseMirror, 42);
    expect(config).toEqual({
      affiliateId: 42,
      mirrorId: 7,
      instanceName: 'user-3',
      targetGroupJid: 'tgt@g.us',
      targetGroupName: 'Destino',
      messageTemplate: '{{link}}',
      subRateMaxMsgs: 5,
      subRateWindowSec: 300,
    });
  });

  it('null quando não há targetGroup', () => {
    expect(buildSourceGroupConfig({ ...baseMirror, targetGroups: null }, 42)).toBeNull();
  });

  it('defaults de sub-rate: 0 msgs / 300s quando null', () => {
    const config = buildSourceGroupConfig(
      { ...baseMirror, subRateLimitMaxMsgs: null, subRateLimitWindowSec: null },
      1,
    );
    expect(config!.subRateMaxMsgs).toBe(0);
    expect(config!.subRateWindowSec).toBe(300);
  });

  it('messageTemplate null é preservado', () => {
    const config = buildSourceGroupConfig({ ...baseMirror, messageTemplate: null }, 1);
    expect(config!.messageTemplate).toBeNull();
  });
});

describe('mirrorHasSourceGroup', () => {
  it('true quando o jid está nos sourceGroups', () => {
    expect(mirrorHasSourceGroup(baseMirror, 'src@g.us')).toBe(true);
  });

  it('false quando não está', () => {
    expect(mirrorHasSourceGroup(baseMirror, 'outro@g.us')).toBe(false);
  });

  it('false para sourceGroups null', () => {
    expect(mirrorHasSourceGroup({ sourceGroups: null }, 'src@g.us')).toBe(false);
  });

  it('false para sourceGroups vazio', () => {
    expect(mirrorHasSourceGroup({ sourceGroups: [] }, 'src@g.us')).toBe(false);
  });
});

describe('diffRemovedGroups', () => {
  it('retorna jids removidos', () => {
    const removed = diffRemovedGroups([{ jid: 'a' }, { jid: 'b' }, { jid: 'c' }], [{ jid: 'b' }]);
    expect(removed.sort()).toEqual(['a', 'c']);
  });

  it('vazio quando nada foi removido', () => {
    expect(diffRemovedGroups([{ jid: 'a' }], [{ jid: 'a' }, { jid: 'b' }])).toEqual([]);
  });

  it('todos removidos quando nova lista é vazia', () => {
    expect(diffRemovedGroups([{ jid: 'a' }], [])).toEqual(['a']);
  });

  it('listas vazias → []', () => {
    expect(diffRemovedGroups([], [])).toEqual([]);
  });

  it('deduplica jids repetidos na lista antiga', () => {
    expect(diffRemovedGroups([{ jid: 'a' }, { jid: 'a' }], [])).toEqual(['a']);
  });
});

describe('groupConfigsByJid', () => {
  it('agrupa por jid', () => {
    const grouped = groupConfigsByJid([
      { jid: 'g1', config: makeConfig(1) },
      { jid: 'g2', config: makeConfig(2) },
      { jid: 'g1', config: makeConfig(3) },
    ]);
    expect(grouped.get('g1')).toHaveLength(2);
    expect(grouped.get('g2')).toHaveLength(1);
  });

  it('dedup por (jid, mirrorId) — último write vence', () => {
    const first = makeConfig(1, 10);
    const second = makeConfig(1, 20);
    const grouped = groupConfigsByJid([
      { jid: 'g1', config: first },
      { jid: 'g1', config: second },
    ]);
    expect(grouped.get('g1')).toHaveLength(1);
    expect(grouped.get('g1')![0]!.affiliateId).toBe(20);
  });

  it('mesmo mirrorId em jids diferentes NÃO deduplica entre jids', () => {
    const grouped = groupConfigsByJid([
      { jid: 'g1', config: makeConfig(1) },
      { jid: 'g2', config: makeConfig(1) },
    ]);
    expect(grouped.get('g1')).toHaveLength(1);
    expect(grouped.get('g2')).toHaveLength(1);
  });

  it('entrada vazia → Map vazio', () => {
    expect(groupConfigsByJid([]).size).toBe(0);
  });
});

describe('firstAffiliateId', () => {
  it('retorna affiliateId da primeira config', () => {
    expect(firstAffiliateId([makeConfig(1, 42), makeConfig(2, 7)])).toBe(42);
  });

  it('lista vazia → null', () => {
    expect(firstAffiliateId([])).toBeNull();
  });
});

describe('firstConfig', () => {
  it('retorna a primeira config', () => {
    const configs = [makeConfig(1, 42), makeConfig(2, 7)];
    expect(firstConfig(configs)).toEqual(makeConfig(1, 42));
  });

  it('lista vazia → null', () => {
    expect(firstConfig([])).toBeNull();
  });
});

describe('buildLegacySourceGroupValue', () => {
  it('serializa formato legado com groupName', () => {
    expect(buildLegacySourceGroupValue(5, 'jid@g.us', 'Grupo', 9)).toBe(
      JSON.stringify({ affiliateId: 5, mirrorId: 9, groupName: 'Grupo' }),
    );
  });

  it('groupName ausente vira string vazia', () => {
    expect(buildLegacySourceGroupValue(5, 'jid@g.us')).toBe(
      JSON.stringify({ affiliateId: 5, mirrorId: undefined, groupName: '' }),
    );
  });
});
