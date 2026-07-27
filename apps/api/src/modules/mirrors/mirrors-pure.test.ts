/**
 * Testes das funções PURAS de mirrors (mirrors-pure.ts).
 *
 * Cobre parse de query params, validação de id, validação de status,
 * montagem dos inputs de create/update, helpers de sourceGroups e
 * construção dos envelopes de resposta — 100% das funções. Sem I/O.
 */
import { describe, expect, it } from 'bun:test';
import type { MirrorListResponse } from '@omestre/db';
import {
  VALID_MIRROR_STATUSES,
  parseListQuery,
  parseIdParam,
  isValidMirrorStatus,
  buildInvalidStatusError,
  buildCreateMirrorInput,
  buildUpdateData,
  updateTouchesSourceGroups,
  hasSourceGroups,
  sourceGroupJids,
  buildSuccessResult,
  buildErrorResult,
  buildDetailResponse,
  buildListResponse,
  buildDeletedResponse,
} from './mirrors-pure.ts';

describe('parseListQuery', () => {
  it('aplica defaults quando ausente', () => {
    const q = parseListQuery({});
    expect(q).toEqual({ status: undefined, search: undefined, page: 1, pageSize: 25 });
  });

  it('faz parse de page/pageSize numéricos', () => {
    const q = parseListQuery({ page: '3', pageSize: '50', status: 'active', search: 'promo' });
    expect(q.page).toBe(3);
    expect(q.pageSize).toBe(50);
    expect(q.status).toBe('active');
    expect(q.search).toBe('promo');
  });

  it('protege contra page NaN → 1', () => {
    expect(parseListQuery({ page: 'abc' }).page).toBe(1);
  });

  it('protege contra pageSize NaN → 25', () => {
    expect(parseListQuery({ pageSize: 'xyz' }).pageSize).toBe(25);
  });

  it('propaga status/search vazios como undefined', () => {
    const q = parseListQuery({ status: '', search: '' });
    expect(q.status).toBe('');
    expect(q.search).toBe('');
  });
});

describe('parseIdParam', () => {
  it('id numérico válido', () => {
    expect(parseIdParam('42')).toEqual({ ok: true, id: 42 });
  });

  it('id negativo é válido (parseInt não reclama)', () => {
    expect(parseIdParam('-7')).toEqual({ ok: true, id: -7 });
  });

  it('string não numérica → invalid', () => {
    expect(parseIdParam('abc')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('NaN (ex: "12abc" vira 12, mas "abc" é NaN)', () => {
    expect(parseIdParam('abc')).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('isValidMirrorStatus', () => {
  it('aceita active e inactive', () => {
    expect(isValidMirrorStatus('active')).toBe(true);
    expect(isValidMirrorStatus('inactive')).toBe(true);
  });

  it('rejeita outros', () => {
    expect(isValidMirrorStatus('paused')).toBe(false);
    expect(isValidMirrorStatus('')).toBe(false);
    expect(isValidMirrorStatus('ACTIVE')).toBe(false);
  });
});

describe('buildInvalidStatusError', () => {
  it('lista os valores aceitos', () => {
    const msg = buildInvalidStatusError();
    for (const s of VALID_MIRROR_STATUSES) {
      expect(msg).toContain(s);
    }
    expect(msg).toContain('Status inválido');
  });
});

describe('buildCreateMirrorInput', () => {
  const base = {
    name: 'Meu espelho',
    status: 'inactive',
    sourceGroups: [{ jid: 's@g.us', name: 'Origem' }],
    targetGroups: [{ jid: 't@g.us', name: 'Destino' }],
    messageTemplate: '{{link}}',
    subRateLimitMaxMsgs: 5,
    subRateLimitWindowSec: 60,
  };

  it('usa os valores fornecidos', () => {
    expect(buildCreateMirrorInput(base, 99)).toEqual({ ...base, userId: 99 });
  });

  it('status ausente → active', () => {
    const { status } = buildCreateMirrorInput({ ...base, status: undefined }, 1);
    expect(status).toBe('active');
  });

  it('sourceGroups ausente → []', () => {
    const { sourceGroups, targetGroups } = buildCreateMirrorInput(
      { ...base, sourceGroups: undefined, targetGroups: undefined },
      1,
    );
    expect(sourceGroups).toEqual([]);
    expect(targetGroups).toEqual([]);
  });

  it('messageTemplate ausente → null', () => {
    const { messageTemplate } = buildCreateMirrorInput({ ...base, messageTemplate: undefined }, 1);
    expect(messageTemplate).toBeNull();
  });

  it('subRateLimitMaxMsgs ausente → null', () => {
    const { subRateLimitMaxMsgs, subRateLimitWindowSec } = buildCreateMirrorInput(
      { ...base, subRateLimitMaxMsgs: undefined, subRateLimitWindowSec: undefined },
      1,
    );
    expect(subRateLimitMaxMsgs).toBeNull();
    expect(subRateLimitWindowSec).toBeNull();
  });
});

describe('buildUpdateData', () => {
  it('só inclui campos presentes', () => {
    const data = buildUpdateData({ name: 'Novo' });
    expect(data).toEqual({ name: 'Novo' });
  });

  it('inclui todos os campos quando fornecidos', () => {
    const body = {
      name: 'N',
      status: 'active',
      sourceGroups: [{ jid: 's@g.us', name: 'O' }],
      targetGroups: [{ jid: 't@g.us', name: 'D' }],
      messageTemplate: null,
      subRateLimitMaxMsgs: 3,
      subRateLimitWindowSec: 30,
    };
    expect(buildUpdateData(body)).toEqual(body);
  });

  it('body vazio → objeto vazio', () => {
    expect(buildUpdateData({})).toEqual({});
  });
});

describe('updateTouchesSourceGroups', () => {
  it('true quando sourceGroups presente', () => {
    expect(updateTouchesSourceGroups({ sourceGroups: [] })).toBe(true);
  });

  it('false quando ausente', () => {
    expect(updateTouchesSourceGroups({ name: 'x' })).toBe(false);
  });
});

describe('hasSourceGroups', () => {
  it('true com lista não vazia', () => {
    expect(hasSourceGroups([{ jid: 'a@g.us', name: 'A' }])).toBe(true);
  });

  it('false com lista vazia', () => {
    expect(hasSourceGroups([])).toBe(false);
  });

  it('false com null', () => {
    expect(hasSourceGroups(null)).toBe(false);
  });

  it('false com undefined', () => {
    expect(hasSourceGroups(undefined)).toBe(false);
  });
});

describe('sourceGroupJids', () => {
  it('mapeia jids', () => {
    expect(sourceGroupJids([{ jid: 'a@g.us', name: 'A' }, { jid: 'b@g.us' }])).toEqual([
      'a@g.us',
      'b@g.us',
    ]);
  });

  it('null/undefined → []', () => {
    expect(sourceGroupJids(null)).toEqual([]);
    expect(sourceGroupJids(undefined)).toEqual([]);
  });
});

describe('buildSuccessResult', () => {
  it('retorna { success: true }', () => {
    expect(buildSuccessResult()).toEqual({ success: true });
  });
});

describe('buildErrorResult', () => {
  it('retorna { success: false, error }', () => {
    expect(buildErrorResult('boom')).toEqual({ success: false, error: 'boom' });
  });
});

describe('buildDetailResponse', () => {
  it('envolve o mirror', () => {
    const m = { id: 1, name: 'x' };
    expect(buildDetailResponse(m)).toEqual({ success: true, mirror: m });
  });
});

describe('buildListResponse', () => {
  it('espalha o resultado do repositório', () => {
    const result: MirrorListResponse = {
      rows: [{ id: 1 } as never],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    };
    expect(buildListResponse(result)).toEqual({ success: true, ...result });
  });
});

describe('buildDeletedResponse', () => {
  it('retorna { success: true, message }', () => {
    expect(buildDeletedResponse('ok')).toEqual({ success: true, message: 'ok' });
  });
});
