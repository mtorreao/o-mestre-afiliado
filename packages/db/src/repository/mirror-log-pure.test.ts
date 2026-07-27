/**
 * Testes das funções PURAS do repositório de logs de mensagens espelhadas.
 *
 * Cobrem normalização de paginação, resolução de JIDs por nome, montagem do
 * Map de nomes e construção das linhas — sem PostgreSQL.
 */
import { describe, expect, it } from 'bun:test';
import {
  normalizeMirrorLogPagination,
  computeMirrorLogTotalPages,
  matchGroupJids,
  buildGroupNamesMap,
  buildMirrorLogRows,
  MIRROR_LOG_MAX_PAGE_SIZE,
  MIRROR_LOG_DEFAULT_PAGE_SIZE,
} from './mirror-log-pure.ts';

const group = (jid: string, name: string) => ({ jid, name });

// ─── normalizeMirrorLogPagination ────────────────────────────────────

describe('normalizeMirrorLogPagination', () => {
  it('usa defaults quando undefined', () => {
    const p = normalizeMirrorLogPagination(undefined, undefined);
    expect(p.page).toBe(1);
    expect(p.pageSize).toBe(MIRROR_LOG_DEFAULT_PAGE_SIZE);
    expect(p.offset).toBe(0);
  });

  it('page mínimo é 1 (zero/negativo)', () => {
    expect(normalizeMirrorLogPagination(0, 10).page).toBe(1);
    expect(normalizeMirrorLogPagination(-5, 10).page).toBe(1);
  });

  it('calcula offset = (page-1) * pageSize', () => {
    const p = normalizeMirrorLogPagination(3, 25);
    expect(p).toEqual({ page: 3, pageSize: 25, offset: 50 });
  });

  it('pageSize máximo é MIRROR_LOG_MAX_PAGE_SIZE (100)', () => {
    expect(normalizeMirrorLogPagination(1, 9999).pageSize).toBe(MIRROR_LOG_MAX_PAGE_SIZE);
    expect(normalizeMirrorLogPagination(1, 9999).offset).toBe(0);
  });

  it('pageSize mínimo é 1 (zero/negativo)', () => {
    expect(normalizeMirrorLogPagination(2, 0).pageSize).toBe(1);
    expect(normalizeMirrorLogPagination(2, -3).pageSize).toBe(1);
    expect(normalizeMirrorLogPagination(2, 0).offset).toBe(1);
  });

  it('page e pageSize válidos preservados', () => {
    expect(normalizeMirrorLogPagination(5, 50)).toEqual({ page: 5, pageSize: 50, offset: 200 });
  });
});

// ─── computeMirrorLogTotalPages ──────────────────────────────────────

describe('computeMirrorLogTotalPages', () => {
  it('calcula teto de total/pageSize', () => {
    expect(computeMirrorLogTotalPages(100, 25)).toBe(4);
    expect(computeMirrorLogTotalPages(101, 25)).toBe(5);
    expect(computeMirrorLogTotalPages(25, 25)).toBe(1);
  });

  it('retorna 0 quando total=0 (comportamento original, sem piso em 1)', () => {
    expect(computeMirrorLogTotalPages(0, 25)).toBe(0);
  });

  it('retorna 0 quando pageSize inválido (<=0)', () => {
    expect(computeMirrorLogTotalPages(50, 0)).toBe(0);
    expect(computeMirrorLogTotalPages(50, -1)).toBe(0);
  });
});

// ─── matchGroupJids ───────────────────────────────────────────────────

describe('matchGroupJids', () => {
  const mirrors = [
    {
      sourceGroups: [group('src1', 'Ofertas Gerais'), group('src2', 'Outro')],
      targetGroups: [group('tgt1', 'Afiliados')],
    },
    {
      sourceGroups: null,
      targetGroups: [group('tgt2', 'Ofertas Gerais Premium')],
    },
  ];

  it('encontra JIDs de source por nome', () => {
    const { matchingSourceJids } = matchGroupJids(mirrors, 'ofertas gerais');
    expect(matchingSourceJids).toContain('src1');
    expect(matchingSourceJids).not.toContain('src2');
  });

  it('encontra JIDs de target por nome (o termo já vem em lowercase do caller)', () => {
    const { matchingTargetJids } = matchGroupJids(mirrors, 'ofertas gerais');
    expect(matchingTargetJids).not.toContain('tgt1'); // "Afiliados" não casa
    expect(matchingTargetJids).toContain('tgt2'); // "Ofertas Gerais Premium" casa
  });

  it('retorna listas vazias quando nada casa', () => {
    const r = matchGroupJids(mirrors, 'zzz');
    expect(r.matchingSourceJids).toEqual([]);
    expect(r.matchingTargetJids).toEqual([]);
  });

  it('lida com grupos nulos/undefined', () => {
    const r = matchGroupJids([{ sourceGroups: undefined, targetGroups: null }], 'x');
    expect(r.matchingSourceJids).toEqual([]);
    expect(r.matchingTargetJids).toEqual([]);
  });

  it('lida com lista de mirrors vazia', () => {
    const r = matchGroupJids([], 'x');
    expect(r.matchingSourceJids).toEqual([]);
    expect(r.matchingTargetJids).toEqual([]);
  });
});

// ─── buildGroupNamesMap ───────────────────────────────────────────────

describe('buildGroupNamesMap', () => {
  it('mapeia jid → nome de source e target', () => {
    const mirrors = [
      { sourceGroups: [group('s1', 'S1Name')], targetGroups: [group('t1', 'T1Name')] },
    ];
    const map = buildGroupNamesMap(mirrors);
    expect(map.get('s1')).toBe('S1Name');
    expect(map.get('t1')).toBe('T1Name');
  });

  it('último mirror vence em conflito de jid', () => {
    const mirrors = [
      { sourceGroups: [group('s1', 'Primeiro')], targetGroups: null },
      { sourceGroups: [group('s1', 'Segundo')], targetGroups: null },
    ];
    expect(buildGroupNamesMap(mirrors).get('s1')).toBe('Segundo');
  });

  it('ignora grupos nulos', () => {
    const map = buildGroupNamesMap([{ sourceGroups: null, targetGroups: undefined }]);
    expect(map.size).toBe(0);
  });

  it('lista vazia → mapa vazio', () => {
    expect(buildGroupNamesMap([]).size).toBe(0);
  });
});

// ─── buildMirrorLogRows ───────────────────────────────────────────────

describe('buildMirrorLogRows', () => {
  const raw = [
    {
      id: 1,
      affiliateId: 9,
      sourceGroupJid: 's1',
      targetGroupJid: 't1',
      originalLink: 'https://a',
      convertedLink: 'https://b',
      marketplace: 'shopee',
      messagePreview: 'oi',
      reflectedAt: new Date('2024-01-01'),
      status: 'sent',
      failureReason: null,
    },
  ];

  it('preenche nomes de grupo a partir do mapa', () => {
    const rows = buildMirrorLogRows(
      raw,
      new Map([
        ['s1', 'S1'],
        ['t1', 'T1'],
      ]),
    );
    expect(rows[0]!.sourceGroupName).toBe('S1');
    expect(rows[0]!.targetGroupName).toBe('T1');
  });

  it('usa null quando jid não está no mapa', () => {
    const rows = buildMirrorLogRows(raw, new Map());
    expect(rows[0]!.sourceGroupName).toBeNull();
    expect(rows[0]!.targetGroupName).toBeNull();
  });

  it('preserva os campos crus', () => {
    const rows = buildMirrorLogRows(raw, new Map());
    expect(rows[0]!.id).toBe(1);
    expect(rows[0]!.marketplace).toBe('shopee');
    expect(rows[0]!.failureReason).toBeNull();
  });

  it('lista vazia → lista vazia', () => {
    expect(buildMirrorLogRows([], new Map())).toEqual([]);
  });
});
